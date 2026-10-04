import type { CipherListView } from "@bitwarden/sdk-internal";

import { ItemKind, type VaultItem } from "../lib/rpc";

function kindOf(cipher: CipherListView): ItemKind {
  const type = cipher.type;
  if (typeof type === "object") {
    if ("login" in type) {
      return ItemKind.Login;
    }
    if ("card" in type) {
      return ItemKind.Card;
    }
    return ItemKind.Other;
  }
  switch (type) {
    case "secureNote":
      return ItemKind.Note;
    case "identity":
      return ItemKind.Identity;
    case "sshKey":
      return ItemKind.SshKey;
    default:
      return ItemKind.Other;
  }
}

/**
 * Projects an SDK list view onto the popup-safe `VaultItem`. Allowlist only: never spread the
 * source object, so fields the SDK adds later (or carries today, like notes) stay out.
 */
export function toVaultItem(cipher: CipherListView): VaultItem {
  const login =
    typeof cipher.type === "object" && "login" in cipher.type ? cipher.type.login : undefined;
  return {
    id: String(cipher.id),
    name: cipher.name,
    subtitle: cipher.subtitle,
    kind: kindOf(cipher),
    favorite: cipher.favorite,
    reprompt: cipher.reprompt !== 0,
    viewPassword: cipher.viewPassword,
    folderId: cipher.folderId === undefined ? undefined : String(cipher.folderId),
    organizationId: cipher.organizationId === undefined ? undefined : String(cipher.organizationId),
    uris: (login?.uris ?? []).map((u) => u.uri).filter((u): u is string => !!u),
    hasUsername: cipher.copyableFields.includes("LoginUsername"),
    hasPassword: cipher.copyableFields.includes("LoginPassword"),
    hasTotp: cipher.copyableFields.includes("LoginTotp"),
    edit: cipher.edit,
    deletedDate: cipher.deletedDate,
    revisionDate: cipher.revisionDate,
  };
}
