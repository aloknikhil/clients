/**
 * Organizations, their collections, and where items may live.
 *
 * Rules follow the reference client: a collection takes new items when the user manages it, has
 * edit access to it, or may edit every item in the org; the data-ownership policy (decided by the
 * SDK, as in the reference `DefaultPolicyService`) removes the personal vault as a destination.
 */
import type {
  Collection as SdkCollection,
  OrganizationUserPolicyContext,
  Policy,
} from "@bitwarden/sdk-internal";

import { prop } from "../lib/props";
import type { Collection, ItemOwner, Organization } from "../lib/rpc";

import { decryptCipher } from "./ciphers";
import { typeOf } from "./edit";
import { repositories, vault } from "./vault";

/** Server `OrganizationUserStatusType.Confirmed`: only confirmed members hold the org key. */
const CONFIRMED = 2;
/** Server `OrganizationUserType`. */
const Role = Object.freeze({ Owner: 0, Admin: 1, User: 2, Custom: 4 } as const);
/** SDK `PolicyType.OrganizationDataOwnership` (formerly "personal ownership"). */
const DATA_OWNERSHIP_POLICY = 5;
/** SDK `CollectionType.DefaultUserCollection`. */
const DEFAULT_USER_COLLECTION = 1;

/** What sync keeps about a membership. Names are plaintext on the server too. */
export interface StoredOrganization {
  id: string;
  name: string;
  status: number;
  type: number;
  enabled: boolean;
  usePolicies: boolean;
  editAnyCollection: boolean;
  allowAdminAccessToAllCollectionItems: boolean;
}

export function toStoredOrganization(org: unknown): StoredOrganization {
  return {
    id: prop<string>(org, "id")!,
    name: prop<string>(org, "name") ?? "",
    status: prop<number>(org, "status") ?? -1,
    type: prop<number>(org, "type") ?? Role.User,
    enabled: prop<boolean>(org, "enabled") === true,
    usePolicies: prop<boolean>(org, "usePolicies") === true,
    editAnyCollection: prop<boolean>(prop(org, "permissions"), "editAnyCollection") === true,
    allowAdminAccessToAllCollectionItems:
      prop<boolean>(org, "allowAdminAccessToAllCollectionItems") === true,
  };
}

/** Reference `Organization.canEditAllCiphers`. */
export function canEditAllItems(org: StoredOrganization): boolean {
  return (
    (org.type === Role.Custom && org.editAnyCollection) ||
    (org.allowAdminAccessToAllCollectionItems &&
      (org.type === Role.Admin || org.type === Role.Owner))
  );
}

/** Reference `CollectionView.canEditItems` (sync only returns collections the user is in). */
export function canAddItems(
  org: StoredOrganization,
  collection: Pick<SdkCollection, "manage" | "readOnly">,
): boolean {
  return canEditAllItems(org) || collection.manage || !collection.readOnly;
}

function usable(org: StoredOrganization): boolean {
  return org.status === CONFIRMED && org.enabled;
}

/** Ids of orgs whose data-ownership policy applies to this user, decided by the SDK. */
function ownershipOrgIds(orgs: StoredOrganization[], policies: Policy[]): Set<string> {
  const contexts: OrganizationUserPolicyContext[] = orgs.map((o) => ({
    id: o.id as never,
    status: o.status as OrganizationUserPolicyContext["status"],
    role: o.type as OrganizationUserPolicyContext["role"],
    enabled: o.enabled,
    usePolicies: o.usePolicies,
    isProviderUser: false,
  }));
  const applicable = vault
    .sdk()
    .policies()
    .filter_by_type(policies, contexts, DATA_OWNERSHIP_POLICY as Policy["type"]);
  return new Set(applicable.map((p) => String(p.organizationId)));
}

export async function listOrganizations(): Promise<Organization[]> {
  const [orgs, encrypted, policies] = await Promise.all([
    repositories.organizations.list(),
    repositories.collections.list(),
    repositories.policies.list(),
  ]);
  const members = orgs.filter(usable);
  if (members.length === 0) {
    return [];
  }
  const owning = ownershipOrgIds(orgs, policies);
  const { successes } = vault.sdk().vault().collections().decrypt_list_with_failures(encrypted);
  const types = new Map(encrypted.map((c) => [String(c.id), c.type]));
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

  return members
    .map((org) => ({
      id: org.id,
      name: org.name,
      ownsItems: owning.has(org.id),
      collections: successes
        .filter((c) => String(c.organizationId) === org.id)
        .map((c): Collection => ({
          id: String(c.id),
          name: c.name,
          canAddItems: canAddItems(org, c),
          isDefault: types.get(String(c.id)) === DEFAULT_USER_COLLECTION,
        }))
        // The user's default collection first, then alphabetical.
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || byName(a, b)),
    }))
    .sort(byName);
}

/**
 * Throws unless the user may put an item there. Organization items need at least one collection
 * the user can add to; the personal vault is closed by any applicable data-ownership policy.
 */
export function checkOwner(owner: ItemOwner, orgs: Organization[], keep: string[] = []): void {
  if (owner.organizationId === undefined) {
    if (orgs.some((o) => o.ownsItems)) {
      throw new Error("Your organization's policy requires items to be saved to the organization");
    }
    return;
  }
  const org = orgs.find((o) => o.id === owner.organizationId);
  if (!org) {
    throw new Error("Organization not found");
  }
  if (owner.collectionIds.length === 0) {
    throw new Error("Choose at least one collection");
  }
  for (const id of owner.collectionIds) {
    // `keep`: collections the item is already in may stay even if the user can't add to them.
    if (!org.collections.some((c) => c.id === id && (c.canAddItems || keep.includes(id)))) {
      throw new Error("You can't add items to that collection");
    }
  }
}

/**
 * - personal -> organization: the server's share, which keeps the item (same id).
 * - within an organization: changes its collections.
 * - out of an organization (to another org, or personal): the server can't re-own an organization
 *   item, so this copies it to the destination and moves the original to the trash.
 */
export async function moveCipher(id: string, owner: ItemOwner): Promise<string> {
  const view = await decryptCipher(id);
  const current = (view.collectionIds ?? []).map(String);
  checkOwner(owner, await listOrganizations(), current);
  const ciphers = vault.sdk().vault().ciphers();
  const from = view.organizationId === undefined ? undefined : String(view.organizationId);

  if (from === owner.organizationId) {
    if (from !== undefined) {
      await ciphers.update_collection(view.id!, owner.collectionIds as never, false);
      vault.invalidate();
    }
    return id;
  }
  if ((view.attachments ?? []).length > 0) {
    throw new Error("Items with attachments can only be moved in the web vault");
  }
  if (from === undefined) {
    await ciphers.share_cipher(
      view,
      owner.organizationId as never,
      owner.collectionIds as never,
      view,
    );
    vault.invalidate();
    return id;
  }

  // A copy must carry everything: refuse items whose password is hidden from the user.
  if (!view.edit || !view.viewPassword) {
    throw new Error("You need full access to this item to move it");
  }
  if (view.permissions && !view.permissions.delete) {
    throw new Error("You can't remove this item from its organization");
  }
  const created = await ciphers.create({
    organizationId: owner.organizationId as never,
    collectionIds: owner.collectionIds as never,
    folderId: view.folderId,
    name: view.name,
    notes: view.notes,
    favorite: view.favorite,
    reprompt: view.reprompt,
    type: typeOf(view),
    fields: view.fields ?? [],
  });
  vault.invalidate();
  try {
    await ciphers.soft_delete(view.id!);
  } catch {
    throw new Error("Copied, but the original couldn't be moved to the trash");
  } finally {
    vault.invalidate();
  }
  return String(created.id);
}
