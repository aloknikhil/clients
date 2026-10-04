import type { Cipher, Folder, Send } from "@bitwarden/sdk-internal";

import { prop } from "../lib/props";

export type Json = Record<string, unknown>;

/** Copies the listed fields, turning `null` into `undefined` the way the SDK's serde expects. */
export function pick<T = Json>(source: unknown, fields: readonly string[]): T | undefined {
  if (source == null || typeof source !== "object") {
    return undefined;
  }
  const out: Json = {};
  for (const field of fields) {
    out[field] = prop(source, field) ?? undefined;
  }
  return out as T;
}

function pickList<T>(source: unknown, fields: readonly string[]): T[] | undefined {
  return Array.isArray(source) ? source.map((item) => pick<T>(item, fields)!) : undefined;
}

const LOGIN_FIELDS = [
  "username",
  "password",
  "passwordRevisionDate",
  "totp",
  "autofillOnPageLoad",
] as const;
const URI_FIELDS = ["uri", "match", "uriChecksum"] as const;
const FIDO2_FIELDS = [
  "credentialId",
  "keyType",
  "keyAlgorithm",
  "keyCurve",
  "keyValue",
  "rpId",
  "userHandle",
  "userName",
  "counter",
  "rpName",
  "userDisplayName",
  "discoverable",
  "creationDate",
] as const;
const CARD_FIELDS = ["cardholderName", "expMonth", "expYear", "code", "brand", "number"] as const;
const IDENTITY_FIELDS = [
  "title",
  "firstName",
  "middleName",
  "lastName",
  "address1",
  "address2",
  "address3",
  "city",
  "state",
  "postalCode",
  "country",
  "company",
  "email",
  "phone",
  "ssn",
  "username",
  "passportNumber",
  "licenseNumber",
] as const;
const BANK_ACCOUNT_FIELDS = [
  "bankName",
  "nameOnAccount",
  "accountType",
  "accountNumber",
  "routingNumber",
  "branchNumber",
  "pin",
  "swiftCode",
  "iban",
  "bankContactPhone",
] as const;
const PASSPORT_FIELDS = [
  "surname",
  "givenName",
  "dateOfBirth",
  "sex",
  "birthPlace",
  "nationality",
  "issuingCountry",
  "passportNumber",
  "passportType",
  "nationalIdentificationNumber",
  "issuingAuthority",
  "issueDate",
  "expirationDate",
] as const;
const DRIVERS_LICENSE_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "dateOfBirth",
  "licenseNumber",
  "issuingCountry",
  "issuingState",
  "issueDate",
  "expirationDate",
  "issuingAuthority",
  "licenseClass",
] as const;

/** Maps a server cipher (sync response) to the SDK's encrypted `Cipher` domain type. */
export function toSdkCipher(c: unknown): Cipher {
  const login = prop(c, "login");
  const permissions = prop(c, "permissions");
  return {
    id: prop(c, "id"),
    organizationId: prop(c, "organizationId") ?? undefined,
    folderId: prop(c, "folderId") ?? undefined,
    collectionIds: prop(c, "collectionIds") ?? [],
    key: prop(c, "key") ?? undefined,
    name: prop(c, "name") ?? undefined,
    notes: prop(c, "notes") ?? undefined,
    type: prop(c, "type")!,
    login:
      login == null
        ? undefined
        : {
            ...pick(login, LOGIN_FIELDS)!,
            uris: pickList(prop(login, "uris"), URI_FIELDS),
            fido2Credentials: pickList(prop(login, "fido2Credentials"), FIDO2_FIELDS),
          },
    card: pick(prop(c, "card"), CARD_FIELDS),
    identity: pick(prop(c, "identity"), IDENTITY_FIELDS),
    secureNote: pick(prop(c, "secureNote"), ["type"]),
    sshKey: pick(prop(c, "sshKey"), ["privateKey", "publicKey", "fingerprint"]),
    bankAccount: pick(prop(c, "bankAccount"), BANK_ACCOUNT_FIELDS),
    passport: pick(prop(c, "passport"), PASSPORT_FIELDS),
    driversLicense: pick(prop(c, "driversLicense"), DRIVERS_LICENSE_FIELDS),
    favorite: prop(c, "favorite") ?? false,
    // The server can send legacy reprompt values; anything non-zero means "password reprompt".
    reprompt: (prop<number>(c, "reprompt") ?? 0) === 0 ? 0 : 1,
    organizationUseTotp: prop(c, "organizationUseTotp") ?? false,
    edit: prop(c, "edit") ?? true,
    permissions: permissions == null ? undefined : pick(permissions, ["delete", "restore"]),
    viewPassword: prop(c, "viewPassword") ?? true,
    localData: undefined,
    attachments: pickList(prop(c, "attachments"), [
      "id",
      "url",
      "size",
      "sizeName",
      "fileName",
      "key",
    ]),
    fields: pickList(prop(c, "fields"), ["name", "value", "type", "linkedId"]),
    passwordHistory: pickList(prop(c, "passwordHistory"), ["password", "lastUsedDate"]),
    creationDate: prop(c, "creationDate")!,
    deletedDate: prop(c, "deletedDate") ?? undefined,
    revisionDate: prop(c, "revisionDate")!,
    archivedDate: prop(c, "archivedDate") ?? undefined,
    data: prop(c, "data") ?? undefined,
  } as Cipher;
}

const SEND_FIELDS = [
  "id",
  "accessId",
  "name",
  "notes",
  "key",
  "password",
  "type",
  "maxAccessCount",
  "accessCount",
  "disabled",
  "hideEmail",
  "revisionDate",
  "deletionDate",
  "expirationDate",
  "emails",
  "authType",
] as const;

/** Server `AuthType` values match the SDK's: Email = 0, Password = 1, None = 2. */
function sendAuthType(s: unknown): number {
  const explicit = prop<number>(s, "authType");
  if (explicit != null) {
    return explicit;
  }
  // Older servers omit authType; infer it the way the server would.
  if (prop(s, "password") != null) {
    return 1;
  }
  return prop(s, "emails") != null ? 0 : 2;
}

export function toSdkSend(s: unknown): Send {
  return {
    ...pick<Json>(s, SEND_FIELDS)!,
    authType: sendAuthType(s),
    file: pick(prop(s, "file"), ["id", "fileName", "size", "sizeName"]),
    text: pick(prop(s, "text"), ["text", "hidden"]),
    data: prop(s, "data") ?? undefined,
  } as Send;
}

export function toSdkFolder(f: unknown): Folder {
  return pick<Folder>(f, ["id", "name", "revisionDate"])!;
}
