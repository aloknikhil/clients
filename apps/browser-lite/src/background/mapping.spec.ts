import { toSdkCipher, toSdkSend } from "./mapping";

const serverLogin = {
  id: "c1",
  organizationId: null,
  folderId: "f1",
  collectionIds: [],
  type: 1,
  name: "2.enc-name",
  notes: null,
  key: null,
  favorite: true,
  reprompt: 1,
  edit: true,
  viewPassword: true,
  organizationUseTotp: false,
  permissions: { delete: true, restore: true },
  revisionDate: "2026-01-01T00:00:00Z",
  creationDate: "2025-01-01T00:00:00Z",
  deletedDate: null,
  archivedDate: null,
  data: "{}",
  login: {
    username: "2.enc-user",
    password: "2.enc-pass",
    passwordRevisionDate: null,
    totp: null,
    autofillOnPageLoad: null,
    uris: [{ uri: "2.enc-uri", match: null, uriChecksum: "2.enc-sum" }],
    fido2Credentials: null,
  },
  fields: [{ name: "2.n", value: "2.v", type: 1, linkedId: null }],
  attachments: null,
  passwordHistory: null,
  // Fields the SDK doesn't model must be dropped rather than passed through.
  object: "cipherDetails",
};

describe("toSdkCipher", () => {
  it("maps a server login cipher onto the SDK shape", () => {
    const cipher = toSdkCipher(serverLogin);
    expect(cipher).toMatchObject({
      id: "c1",
      folderId: "f1",
      type: 1,
      name: "2.enc-name",
      favorite: true,
      reprompt: 1,
      permissions: { delete: true, restore: true },
      login: {
        username: "2.enc-user",
        password: "2.enc-pass",
        uris: [{ uri: "2.enc-uri", match: undefined, uriChecksum: "2.enc-sum" }],
        fido2Credentials: undefined,
      },
      fields: [{ name: "2.n", value: "2.v", type: 1, linkedId: undefined }],
    });
    expect(cipher).not.toHaveProperty("object");
  });

  it("turns nulls into undefined", () => {
    const cipher = toSdkCipher(serverLogin);
    expect(cipher.organizationId).toBeUndefined();
    expect(cipher.notes).toBeUndefined();
    expect(cipher.deletedDate).toBeUndefined();
    expect(cipher.login?.totp).toBeUndefined();
  });

  it("accepts PascalCase responses", () => {
    const cipher = toSdkCipher({
      Id: "c2",
      Type: 2,
      Name: "2.x",
      SecureNote: { Type: 0 },
      RevisionDate: "r",
      CreationDate: "c",
    });
    expect(cipher).toMatchObject({ id: "c2", type: 2, name: "2.x", secureNote: { type: 0 } });
  });

  it("normalizes legacy reprompt values to password reprompt", () => {
    expect(toSdkCipher({ ...serverLogin, reprompt: 2 }).reprompt).toBe(1);
    expect(toSdkCipher({ ...serverLogin, reprompt: null }).reprompt).toBe(0);
  });

  it("defaults permissions-related flags when the server omits them", () => {
    const rest: Record<string, unknown> = { ...serverLogin };
    for (const key of ["edit", "viewPassword", "favorite", "collectionIds"]) {
      delete rest[key];
    }
    const cipher = toSdkCipher(rest);
    expect(cipher).toMatchObject({
      edit: true,
      viewPassword: true,
      favorite: false,
      collectionIds: [],
    });
  });
});

describe("toSdkSend", () => {
  const base = {
    id: "s1",
    accessId: "a",
    name: "2.n",
    key: "2.k",
    type: 0,
    text: { text: "2.t", hidden: false },
  };

  it.each([
    [{ authType: 0 }, 0],
    [{ password: "hash" }, 1],
    [{ emails: "a@b.c" }, 0],
    [{}, 2],
  ])("derives authType from %p", (extra, expected) => {
    expect(toSdkSend({ ...base, ...extra }).authType).toBe(expected);
  });
});
