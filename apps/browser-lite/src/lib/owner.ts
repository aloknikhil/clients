import type { ItemOwner, Organization } from "./rpc";

/** Collections in `org` the user may put items in, their default collection first. */
export function addableCollections(org: Organization) {
  return org.collections.filter((c) => c.canAddItems);
}

/** Where to put an item in `org` when the user hasn't chosen: their default collection if any. */
export function ownerIn(org: Organization): ItemOwner {
  const collection = addableCollections(org)[0];
  return { organizationId: org.id, collectionIds: collection ? [collection.id] : [] };
}

/**
 * Where new items go by default: the personal vault, unless an organization's data-ownership
 * policy applies, in which case that organization (as the reference client does).
 */
export function defaultOwner(orgs: Organization[]): ItemOwner {
  const owning = orgs.find((o) => o.ownsItems);
  return owning ? ownerIn(owning) : { collectionIds: [] };
}

/** True when the personal vault is a valid destination. */
export function personalAllowed(orgs: Organization[]): boolean {
  return !orgs.some((o) => o.ownsItems);
}
