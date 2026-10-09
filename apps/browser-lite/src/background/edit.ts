import type { CipherView, CipherViewType } from "@bitwarden/sdk-internal";

import type { Folder, ItemOwner } from "../lib/rpc";

import { decryptCipher } from "./ciphers";
import { checkOwner, listOrganizations } from "./orgs";
import { repositories, vault } from "./vault";

/** SDK `CipherType`. */
const CipherType = Object.freeze({
  Login: 1,
  SecureNote: 2,
  Card: 3,
  Identity: 4,
  SshKey: 5,
} as const);

export function typeOf(view: CipherView): CipherViewType {
  switch (view.type) {
    case CipherType.Login:
      return { login: view.login! };
    case CipherType.Card:
      return { card: view.card! };
    case CipherType.Identity:
      return { identity: view.identity! };
    case CipherType.SshKey:
      return { sshKey: view.sshKey! };
    default:
      return { secureNote: view.secureNote ?? { type: 0 } };
  }
}

function blankToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

/** Drops empty URIs and fields so the editor's blank rows don't get saved. */
function tidy(view: CipherView): CipherView {
  const login = view.login && {
    ...view.login,
    username: blankToUndefined(view.login.username),
    password: blankToUndefined(view.login.password),
    totp: blankToUndefined(view.login.totp),
    uris: (view.login.uris ?? []).filter((u) => blankToUndefined(u.uri) !== undefined),
  };
  return {
    ...view,
    name: view.name.trim(),
    notes: blankToUndefined(view.notes),
    login,
    fields: (view.fields ?? []).filter(
      (f) => blankToUndefined(f.name) !== undefined || blankToUndefined(f.value) !== undefined,
    ),
  };
}

/**
 * Creates or edits an item from the popup's edited view. Edits start from the decrypted original:
 * the popup can't widen what it may change. Items the user can't fully edit only take favorite and
 * folder; items with a hidden password keep their real password and TOTP (the popup never had them).
 */
export async function saveCipher(draft: CipherView): Promise<string> {
  const ciphers = vault.sdk().vault().ciphers();
  const view = tidy(draft);
  if (view.name === "") {
    throw new Error("Name is required");
  }

  if (view.id === undefined) {
    const owner: ItemOwner = {
      organizationId: view.organizationId === undefined ? undefined : String(view.organizationId),
      collectionIds: (view.collectionIds ?? []).map(String),
    };
    checkOwner(owner, await listOrganizations());
    const created = await ciphers.create({
      organizationId: owner.organizationId as never,
      collectionIds: owner.organizationId === undefined ? [] : (owner.collectionIds as never),
      folderId: view.folderId,
      name: view.name,
      notes: view.notes,
      favorite: view.favorite,
      reprompt: view.reprompt,
      type: typeOf(view),
      fields: view.fields ?? [],
    });
    vault.invalidate();
    return String(created.id);
  }

  const original = await decryptCipher(String(view.id));
  if (!original.edit) {
    await ciphers.edit_partial({
      id: original.id!,
      folderId: view.folderId,
      favorite: view.favorite,
    });
    vault.invalidate();
    return String(original.id);
  }
  if (!original.viewPassword && original.login && view.login) {
    view.login = { ...view.login, password: original.login.password, totp: original.login.totp };
  }
  await ciphers.edit({
    id: original.id!,
    organizationId: original.organizationId,
    folderId: view.folderId,
    favorite: view.favorite,
    reprompt: view.reprompt,
    name: view.name,
    notes: view.notes,
    fields: view.fields ?? [],
    type: typeOf({ ...view, type: original.type }),
    revisionDate: original.revisionDate,
    archivedDate: original.archivedDate,
    attachments: original.attachments ?? [],
    key: original.key,
  });
  vault.invalidate();
  return String(original.id);
}

export async function setFavorite(id: string, favorite: boolean): Promise<void> {
  const original = await decryptCipher(id);
  await vault
    .sdk()
    .vault()
    .ciphers()
    .edit_partial({ id: original.id!, folderId: original.folderId, favorite });
  vault.invalidate();
}

/** Adds a website to a login (used by "fill and save site"). No-op if already present. */
export async function addUri(id: string, uri: string): Promise<void> {
  const original = await decryptCipher(id);
  if (!original.edit || !original.login) {
    return;
  }
  const uris = original.login.uris ?? [];
  if (uris.some((u) => u.uri === uri)) {
    return;
  }
  await saveCipher({
    ...original,
    login: {
      ...original.login,
      uris: [...uris, { uri, match: undefined, uriChecksum: undefined }],
    },
  });
}

export async function trashCipher(id: string): Promise<void> {
  await vault
    .sdk()
    .vault()
    .ciphers()
    .soft_delete(id as never);
  vault.invalidate();
}

export async function restoreCipher(id: string): Promise<void> {
  await vault
    .sdk()
    .vault()
    .ciphers()
    .restore(id as never);
  vault.invalidate();
}

export async function deleteCipherForever(id: string): Promise<void> {
  await vault
    .sdk()
    .vault()
    .ciphers()
    .delete(id as never);
  vault.invalidate();
}

export async function listFolders(): Promise<Folder[]> {
  const folders = vault
    .sdk()
    .vault()
    .folders()
    .decrypt_list(await repositories.folders.list());
  return folders
    .map((f) => ({ id: String(f.id), name: f.name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function createFolder(name: string): Promise<Folder> {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new Error("Folder name is required");
  }
  const folder = await vault.sdk().vault().folders().create({ name: trimmed });
  return { id: String(folder.id), name: folder.name };
}
