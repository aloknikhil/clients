/**
 * Wire format between the page hook, the bridge and the service worker. Binary values travel as
 * base64url strings (the same encoding the reference client uses), never as raw buffers.
 */

export interface GetRequest {
  kind: "get";
  rpId?: string;
  challenge: string;
  allowCredentials: string[];
  userVerification?: UserVerificationRequirement;
  mediation?: CredentialMediationRequirement;
  timeout?: number;
}

export interface CreateRequest {
  kind: "create";
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  challenge: string;
  pubKeyCredParams: { type: string; alg: number }[];
  excludeCredentials: string[];
  residentKey?: ResidentKeyRequirement;
  requireResidentKey?: boolean;
  userVerification?: UserVerificationRequirement;
  credProps?: boolean;
  timeout?: number;
}

export type WebAuthnRequest = GetRequest | CreateRequest;

export interface AssertionResult {
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle: string;
}

export interface AttestationResult {
  credentialId: string;
  clientDataJSON: string;
  attestationObject: string;
  authData: string;
  publicKey: string;
  publicKeyAlgorithm: number;
  transports: string[];
  rk?: boolean;
}

/** What the service worker answers. `fallback` asks the page to use the browser's own WebAuthn. */
export type WebAuthnResponse =
  | { ok: true; result: AssertionResult | AttestationResult }
  | { ok: false; fallback: true }
  | { ok: false; error: { name: string; message: string } };

export function toB64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stored credential ids are either GUIDs (created by Bitwarden clients) or `b64.`-prefixed
 * base64url (imported). Mirrors `parseCredentialId` in libs/common fido2/credential-id-utils.
 */
export function parseCredentialId(stored: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    if (stored.startsWith("b64.")) {
      return fromB64Url(stored.slice(4));
    }
    if (!GUID.test(stored)) {
      return undefined;
    }
    const hex = stored.replace(/-/g, "");
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  } catch {
    return undefined;
  }
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

const B64URL = /^[A-Za-z0-9_-]*$/;
/**
 * Generous on purpose: the spec sets no maximum for challenges, and real RPs send big ones (Google's
 * sign-in challenge is several KB). These caps only bound message size.
 */
const MAX_B64 = 64 * 1024;
const MAX_CREDENTIALS = 256;
const isStr = (v: unknown, max = 2048): v is string => typeof v === "string" && v.length <= max;
const isB64 = (v: unknown): v is string => isStr(v, MAX_B64) && B64URL.test(v);
const optStr = (v: unknown) => v === undefined || isStr(v);
const b64List = (v: unknown) => Array.isArray(v) && v.length <= MAX_CREDENTIALS && v.every(isB64);

/** Name of the first failed check, so a rejected request says which field was wrong. */
function firstInvalid(checks: Record<string, boolean>): string | undefined {
  return Object.entries(checks).find(([, ok]) => !ok)?.[0];
}

/**
 * The page controls the request entirely: accept only well-formed shapes. `onInvalid` gets the
 * name of the offending field (never its value).
 */
export function sanitizeRequest(
  raw: unknown,
  onInvalid?: (field: string) => void,
): WebAuthnRequest | undefined {
  const reject = (field: string) => {
    onInvalid?.(field);
    return undefined;
  };
  if (typeof raw !== "object" || raw === null) {
    return reject("request");
  }
  const r = raw as Record<string, unknown>;
  if (r.kind === "get") {
    const invalid = firstInvalid({
      challenge: isB64(r.challenge),
      allowCredentials: b64List(r.allowCredentials),
      rpId: optStr(r.rpId),
      mediation: optStr(r.mediation),
      userVerification: optStr(r.userVerification),
    });
    if (invalid) {
      return reject(invalid);
    }
    return {
      kind: "get",
      rpId: r.rpId as string | undefined,
      challenge: r.challenge as string,
      allowCredentials: r.allowCredentials as string[],
      userVerification: r.userVerification as UserVerificationRequirement | undefined,
      mediation: r.mediation as CredentialMediationRequirement | undefined,
      timeout: typeof r.timeout === "number" ? r.timeout : undefined,
    };
  }
  if (r.kind === "create") {
    const rp = r.rp as Record<string, unknown> | undefined;
    const user = r.user as Record<string, unknown> | undefined;
    const params = r.pubKeyCredParams;
    if (!rp || !user) {
      return reject(rp ? "user" : "rp");
    }
    const invalid = firstInvalid({
      challenge: isB64(r.challenge),
      excludeCredentials: b64List(r.excludeCredentials),
      "rp.id": optStr(rp.id),
      "rp.name": isStr(rp.name),
      "user.id": isB64(user.id),
      "user.name": isStr(user.name),
      "user.displayName": isStr(user.displayName),
      pubKeyCredParams:
        Array.isArray(params) &&
        params.length <= 32 &&
        params.every(
          (p) =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as { alg?: unknown }).alg === "number" &&
            isStr((p as { type?: unknown }).type),
        ),
    });
    if (invalid) {
      return reject(invalid);
    }
    return {
      kind: "create",
      rp: { id: rp.id as string | undefined, name: rp.name as string },
      user: {
        id: user.id as string,
        name: user.name as string,
        displayName: user.displayName as string,
      },
      challenge: r.challenge as string,
      pubKeyCredParams: params as { type: string; alg: number }[],
      excludeCredentials: r.excludeCredentials as string[],
      residentKey: r.residentKey as ResidentKeyRequirement | undefined,
      requireResidentKey: r.requireResidentKey as boolean | undefined,
      userVerification: r.userVerification as UserVerificationRequirement | undefined,
      credProps: r.credProps === true,
      timeout: typeof r.timeout === "number" ? r.timeout : undefined,
    };
  }
  return reject("kind");
}
