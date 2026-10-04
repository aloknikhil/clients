import type { CipherListView } from "@bitwarden/sdk-internal";

import { toVaultItem } from "./items";

const login = {
  id: "c1",
  name: "Example",
  subtitle: "alice",
  type: {
    login: {
      username: "alice",
      totp: "JBSWY3DPEHPK3PXP",
      hasFido2: false,
      uris: [{ uri: "https://example.com" }],
    },
  },
  favorite: false,
  reprompt: 0,
  viewPassword: true,
  edit: true,
  notes: "Recovery codes: 1234 5678",
  fields: [{ name: "PIN", value: "0000" }],
  copyableFields: ["LoginUsername", "LoginPassword", "LoginTotp"],
  revisionDate: "2026-01-01T00:00:00Z",
} as unknown as CipherListView;

describe("toVaultItem", () => {
  it("never exposes notes, custom fields or the TOTP seed", () => {
    const serialized = JSON.stringify(toVaultItem(login));
    expect(serialized).not.toContain("Recovery codes");
    expect(serialized).not.toContain("0000");
    expect(serialized).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("keeps what the list needs", () => {
    expect(toVaultItem(login)).toEqual({
      id: "c1",
      name: "Example",
      subtitle: "alice",
      kind: "login",
      favorite: false,
      reprompt: false,
      viewPassword: true,
      folderId: undefined,
      organizationId: undefined,
      uris: ["https://example.com"],
      hasUsername: true,
      hasPassword: true,
      hasTotp: true,
      edit: true,
      hasPasskey: false,
      deletedDate: undefined,
      revisionDate: "2026-01-01T00:00:00Z",
    });
  });

  it("classifies non-login items", () => {
    expect(toVaultItem({ ...login, type: "secureNote" } as CipherListView).kind).toBe("note");
    expect(
      toVaultItem({ ...login, type: { card: { brand: "Visa" } } } as CipherListView).kind,
    ).toBe("card");
  });
});
