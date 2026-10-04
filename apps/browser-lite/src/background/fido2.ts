/**
 * Passkey (WebAuthn) authority. The page hook and bridge only marshal; every decision is made here.
 *
 * Security model:
 * - The requesting origin comes from Chrome (`port.sender`), never from the page.
 * - Origins must be https (localhost excepted) and the rpId must be valid for the origin, using the
 *   reference `isValidRpId` (libs/common fido2/domain-utils), including Related Origin Requests.
 * - Cross-origin iframes are handed back to the browser's own WebAuthn, which enforces Permissions
 *   Policy for them.
 * - Nothing is ever signed or created without an explicit choice in our UI (inline menu or prompt
 *   window), made while the vault is unlocked.
 *
 * KEY MANAGEMENT REVIEW: `generateAuthData`, `sign` and `createCredential` port the reference
 * `Fido2AuthenticatorService` (libs/common/src/platform/services/fido2/fido2-authenticator.service.ts)
 * because the SDK doesn't expose a FIDO2 authenticator to JS yet. Keys are P-256 ECDSA via WebCrypto,
 * stored as PKCS#8 in the cipher (encrypted by the SDK on save), exactly as the reference does.
 */
import { parse } from "tldts";

import { CBOR } from "@bitwarden/common/platform/services/fido2/cbor";
import { isValidRpId } from "@bitwarden/common/platform/services/fido2/domain-utils";
import { p1363ToDer } from "@bitwarden/common/platform/services/fido2/ecdsa-utils";
import type { CipherListView, CipherView, Fido2CredentialView } from "@bitwarden/sdk-internal";

import type { PasskeyChoice, WebAuthnChoice, WebAuthnPrompt } from "../lib/rpc";
import {
  fromB64Url,
  parseCredentialId,
  sameBytes,
  sanitizeRequest,
  toB64Url,
  type AssertionResult,
  type AttestationResult,
  type CreateRequest,
  type GetRequest,
  type WebAuthnRequest,
  type WebAuthnResponse,
} from "../lib/webauthn";

import { decryptCipher } from "./ciphers";
import { saveCipher } from "./edit";
import { vault } from "./vault";

/** Bitwarden's authenticator AAGUID (d548826e-79b4-db40-a3d8-11116f7e8349), as in the reference. */
const AAGUID = new Uint8Array([
  0xd5, 0x48, 0x82, 0x6e, 0x79, 0xb4, 0xdb, 0x40, 0xa3, 0xd8, 0x11, 0x11, 0x6f, 0x7e, 0x83, 0x49,
]);
const ES256 = -7;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

interface Pending {
  id: string;
  tabId: number;
  origin: string;
  rpId: string;
  request: WebAuthnRequest;
  fallbackSupported: boolean;
  windowId?: number;
  settle(response: WebAuthnResponse): void;
}

const pending = new Map<string, Pending>();

const fail = (name: string, message: string): WebAuthnResponse => ({
  ok: false,
  error: { name, message },
});

function hostnameOf(origin: string): string {
  return new URL(origin).hostname;
}

function requireResidentKey(request: CreateRequest): boolean {
  // Same quirk handling as the reference: some RPs send requireResidentKey as a string.
  return (
    request.residentKey === "required" ||
    request.residentKey === "preferred" ||
    (request.residentKey === undefined &&
      (request.requireResidentKey === true || (request.requireResidentKey as unknown) === "true"))
  );
}

function loginPasskeys(cipher: CipherListView) {
  return typeof cipher.type === "object" && "login" in cipher.type
    ? (cipher.type.login.fido2Credentials ?? [])
    : [];
}

function matchesAllowList(credentialId: string, allow: string[]): boolean {
  const id = parseCredentialId(credentialId);
  return id !== undefined && allow.some((a) => sameBytes(fromB64Url(a), id));
}

/** Logins holding a passkey usable for this request. */
async function candidatesFor(rpId: string, request: GetRequest): Promise<PasskeyChoice[]> {
  const ciphers = await vault.list();
  const choices: PasskeyChoice[] = [];
  for (const cipher of ciphers) {
    const passkey = loginPasskeys(cipher).find(
      (p) =>
        p.rpId === rpId &&
        (request.allowCredentials.length === 0 ||
          matchesAllowList(p.credentialId, request.allowCredentials)),
    );
    if (passkey) {
      choices.push({
        cipherId: String(cipher.id),
        name: cipher.name,
        userName: passkey.userName ?? undefined,
        savedAt: cipher.creationDate,
        shortId: passkey.credentialId.replace(/^b64\./, "").slice(0, 6),
      });
    }
  }
  // Newest first: the passkey a site most likely knows about.
  return choices.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

async function generateAuthData(params: {
  rpId: string;
  counter: number;
  credentialId?: Uint8Array;
  publicKey?: CryptoKey;
}): Promise<Uint8Array<ArrayBuffer>> {
  const authData: number[] = [];
  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(params.rpId)),
  );
  authData.push(...rpIdHash);
  // UP | UV | BE | BS (+ AT when attesting): credentials are synced, and the user explicitly chose
  // the passkey in an unlocked vault, which is our user verification.
  let flags = 0b00000001 | 0b00000100 | 0b00001000 | 0b00010000;
  if (params.publicKey) {
    flags |= 0b01000000;
  }
  authData.push(flags);
  const c = params.counter;
  authData.push((c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff);

  if (params.publicKey && params.credentialId) {
    authData.push(...AAGUID);
    const rawId = params.credentialId;
    authData.push((rawId.length >> 8) & 0xff, rawId.length & 0xff, ...rawId);
    const jwk = await crypto.subtle.exportKey("jwk", params.publicKey);
    // COSE EC2 P-256 key in CTAP2 canonical CBOR, built by hand exactly like the reference.
    const cose = new Uint8Array(77);
    cose.set([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20], 0);
    cose.set(fromB64Url(jwk.x!), 10);
    cose.set([0x22, 0x58, 0x20], 42);
    cose.set(fromB64Url(jwk.y!), 45);
    authData.push(...cose);
  }
  return new Uint8Array(authData);
}

async function sign(
  authData: Uint8Array,
  clientDataHash: ArrayBuffer,
  credential: Fido2CredentialView,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    fromB64Url(credential.keyValue),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const message = new Uint8Array(authData.length + clientDataHash.byteLength);
  message.set(authData, 0);
  message.set(new Uint8Array(clientDataHash), authData.length);
  const p1363 = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, message),
  );
  return p1363ToDer(p1363);
}

function clientData(type: "webauthn.get" | "webauthn.create", challenge: string, origin: string) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ type, challenge, origin, crossOrigin: false }),
  );
  return { bytes, hash: crypto.subtle.digest("SHA-256", bytes) };
}

async function assertWith(p: Pending, cipherId: string): Promise<AssertionResult> {
  const request = p.request as GetRequest;
  const cipher = await decryptCipher(cipherId);
  const credential = cipher.login?.fido2Credentials?.find(
    (c) =>
      c.rpId === p.rpId &&
      (request.allowCredentials.length > 0
        ? matchesAllowList(c.credentialId, request.allowCredentials)
        : c.discoverable === "true"),
  );
  const credentialId = credential ? parseCredentialId(credential.credentialId) : undefined;
  if (!credential || !credentialId) {
    throw new DOMException("No usable passkey", "NotAllowedError");
  }

  // Counters stay 0 unless the RP's credential already counts (same as the reference).
  let counter = Number(credential.counter) || 0;
  if (counter > 0 && cipher.edit) {
    counter++;
    await saveCipher({
      ...cipher,
      login: {
        ...cipher.login!,
        fido2Credentials: cipher.login!.fido2Credentials!.map((c) =>
          c.credentialId === credential.credentialId ? { ...c, counter: String(counter) } : c,
        ),
      },
    });
  }

  const data = clientData("webauthn.get", request.challenge, p.origin);
  const authData = await generateAuthData({ rpId: p.rpId, counter });
  const signature = await sign(authData, await data.hash, credential);
  return {
    credentialId: toB64Url(credentialId),
    clientDataJSON: toB64Url(data.bytes),
    authenticatorData: toB64Url(authData),
    signature: toB64Url(signature),
    userHandle: credential.userHandle ?? "",
  };
}

async function createWith(p: Pending, target: string | "new"): Promise<AttestationResult> {
  const request = p.request as CreateRequest;
  // Re-checked here: the vault may have been locked when the request arrived.
  if (request.excludeCredentials.length > 0) {
    const existing = (await vault.list()).flatMap(loginPasskeys);
    if (
      existing.some(
        (c) => c.rpId === p.rpId && matchesAllowList(c.credentialId, request.excludeCredentials),
      )
    ) {
      throw new DOMException("A passkey for this account is already saved", "InvalidStateError");
    }
  }
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
  ]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const resident = requireResidentKey(request);
  const credential: Fido2CredentialView = {
    credentialId: crypto.randomUUID(),
    keyType: "public-key",
    keyAlgorithm: "ECDSA",
    keyCurve: "P-256",
    keyValue: toB64Url(pkcs8),
    rpId: p.rpId,
    userHandle: request.user.id,
    userName: request.user.name,
    counter: "0",
    rpName: request.rp.name,
    userDisplayName: request.user.displayName,
    discoverable: String(resident),
    creationDate: new Date().toISOString(),
  };
  pkcs8.fill(0);

  if (target === "new") {
    const now = new Date().toISOString();
    await saveCipher({
      id: undefined,
      organizationId: undefined,
      folderId: undefined,
      collectionIds: [],
      key: undefined,
      name: request.rp.name || p.rpId,
      notes: undefined,
      type: 1,
      login: {
        username: request.user.name || undefined,
        password: undefined,
        passwordRevisionDate: undefined,
        uris: [{ uri: p.origin, match: undefined, uriChecksum: undefined }],
        totp: undefined,
        autofillOnPageLoad: undefined,
        fido2Credentials: [credential],
      },
      favorite: false,
      reprompt: 0,
      organizationUseTotp: false,
      edit: true,
      viewPassword: true,
      fields: [],
      creationDate: now,
      revisionDate: now,
    } as unknown as CipherView);
  } else {
    const cipher = await decryptCipher(target);
    if (!cipher.edit || !cipher.login) {
      throw new DOMException("Item can't be edited", "NotAllowedError");
    }
    await saveCipher({
      ...cipher,
      login: {
        ...cipher.login,
        username: cipher.login.username || request.user.name,
        fido2Credentials: [credential],
      },
    });
  }

  const rawId = parseCredentialId(credential.credentialId)!;
  const authData = await generateAuthData({
    rpId: p.rpId,
    counter: 0,
    credentialId: rawId,
    publicKey: keyPair.publicKey,
  });
  const data = clientData("webauthn.create", request.challenge, p.origin);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  return {
    credentialId: toB64Url(rawId),
    clientDataJSON: toB64Url(data.bytes),
    attestationObject: toB64Url(
      new Uint8Array(CBOR.encode({ fmt: "none", attStmt: {}, authData })),
    ),
    authData: toB64Url(authData),
    publicKey: toB64Url(spki),
    publicKeyAlgorithm: ES256,
    transports: ["internal", "hybrid"],
    rk: resident,
  };
}

async function openPrompt(p: Pending): Promise<void> {
  const created = await chrome.windows.create({
    url: chrome.runtime.getURL(`popup/index.html#webauthn=${p.id}`),
    type: "popup",
    width: 380,
    height: 600,
    focused: true,
  });
  p.windowId = created?.id;
}

function settle(id: string, response: WebAuthnResponse): void {
  const p = pending.get(id);
  if (!p) {
    return;
  }
  pending.delete(id);
  p.settle(response);
  if (p.windowId !== undefined) {
    void chrome.windows.remove(p.windowId).catch(() => undefined);
  }
}

/** Validates a page request and either answers it or parks it for the user's choice. */
async function begin(
  request: WebAuthnRequest,
  sender: chrome.runtime.MessageSender,
  fallbackSupported: boolean,
  respond: (response: WebAuthnResponse) => void,
): Promise<string | undefined> {
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : undefined);
  const tabId = sender.tab?.id;
  if (!origin || tabId === undefined) {
    respond(fail("NotAllowedError", "Unknown origin"));
    return;
  }
  const hostname = hostnameOf(origin);
  if (!origin.startsWith("https://") && hostname !== "localhost") {
    respond(fail("SecurityError", "'origin' is not a valid https origin"));
    return;
  }
  // Cross-origin iframes: the browser applies Permissions Policy; let it handle them.
  const topOrigin = sender.tab?.url ? new URL(sender.tab.url).origin : undefined;
  if (sender.frameId !== 0 && topOrigin !== origin) {
    respond(
      fallbackSupported
        ? { ok: false, fallback: true }
        : fail("NotAllowedError", "Cross-origin request"),
    );
    return;
  }

  const rpId = (request.kind === "get" ? request.rpId : request.rp.id) ?? hostname;
  if (!parse(rpId).hostname || !(await isValidRpId(rpId, origin))) {
    respond(fail("SecurityError", "'rp.id' cannot be used with the current origin"));
    return;
  }

  if (request.kind === "create") {
    if (
      request.pubKeyCredParams.length > 0 &&
      !request.pubKeyCredParams.some((p) => p.alg === ES256 && p.type === "public-key")
    ) {
      respond(
        fallbackSupported
          ? { ok: false, fallback: true }
          : fail("NotSupportedError", "No supported algorithm"),
      );
      return;
    }
    const userId = fromB64Url(request.user.id);
    if (userId.length < 1 || userId.length > 64) {
      respond(fail("TypeError", "Invalid 'user.id' length"));
      return;
    }
    if (vault.unlocked && request.excludeCredentials.length > 0) {
      const existing = (await vault.list()).flatMap(loginPasskeys);
      if (
        existing.some(
          (p) => p.rpId === rpId && matchesAllowList(p.credentialId, request.excludeCredentials),
        )
      ) {
        respond(fail("InvalidStateError", "A passkey for this account is already saved"));
        return;
      }
    }
  }

  const id = crypto.randomUUID();
  const p: Pending = { id, tabId, origin, rpId, request, fallbackSupported, settle: respond };
  pending.set(id, p);

  const conditional = request.kind === "get" && request.mediation === "conditional";
  if (!conditional) {
    if (
      request.kind === "get" &&
      vault.unlocked &&
      (await candidatesFor(rpId, request)).length === 0
    ) {
      settle(
        id,
        fallbackSupported ? { ok: false, fallback: true } : fail("NotAllowedError", "No passkeys"),
      );
      return;
    }
    const timeout = Math.min(request.timeout ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    setTimeout(() => settle(id, fail("NotAllowedError", "The operation timed out")), timeout);
    await openPrompt(p);
  }
  return id;
}

/** For the prompt window (popup app, trusted channel). */
export async function describeRequest(id: string): Promise<WebAuthnPrompt | undefined> {
  const p = pending.get(id);
  if (!p) {
    return undefined;
  }
  const host = hostnameOf(p.origin);
  if (p.request.kind === "get") {
    return {
      kind: "get" as const,
      host,
      siteName: parse(p.rpId).domain ?? host,
      rpId: p.rpId,
      fallbackSupported: p.fallbackSupported,
      choices: vault.unlocked ? await candidatesFor(p.rpId, p.request) : [],
    };
  }
  // Logins for this site that don't have a passkey yet can receive the new one.
  const logins = vault.unlocked ? await vault.list() : [];
  const targets: PasskeyChoice[] = logins
    .filter(
      (c) =>
        typeof c.type === "object" &&
        "login" in c.type &&
        c.edit &&
        loginPasskeys(c).length === 0 &&
        (c.type.login.uris ?? []).some((u) => {
          const h = u.uri ? parse(u.uri).domain : undefined;
          return h !== undefined && h === parse(p.rpId).domain;
        }),
    )
    .map((c) => ({
      cipherId: String(c.id),
      name: c.name,
      userName: c.subtitle || undefined,
      savedAt: c.creationDate,
      shortId: "",
    }));
  return {
    kind: "create" as const,
    host,
    siteName: p.request.rp.name || (parse(p.rpId).domain ?? host),
    rpId: p.rpId,
    rpName: p.request.rp.name,
    userName: p.request.user.name,
    fallbackSupported: p.fallbackSupported,
    choices: targets,
  };
}

export async function respond(id: string, choice: WebAuthnChoice): Promise<void> {
  const p = pending.get(id);
  if (!p) {
    return;
  }
  if ("cancel" in choice) {
    settle(id, fail("NotAllowedError", "The user cancelled"));
    return;
  }
  if ("fallback" in choice) {
    settle(
      id,
      p.fallbackSupported
        ? { ok: false, fallback: true }
        : fail("NotAllowedError", "No authenticator"),
    );
    return;
  }
  if (!vault.unlocked) {
    throw new Error("Vault is locked");
  }
  try {
    const result =
      p.request.kind === "get"
        ? await assertWith(p, (choice as { cipherId: string }).cipherId)
        : await createWith(p, "newLogin" in choice ? "new" : choice.cipherId);
    settle(id, { ok: true, result });
  } catch (e) {
    settle(
      id,
      fail(
        e instanceof DOMException ? e.name : "NotAllowedError",
        e instanceof Error ? e.message : String(e),
      ),
    );
  }
}

/** Passkey autofill: pending conditional requests for this tab, with what the user can pick. */
export async function conditionalChoices(
  tabId: number,
): Promise<{ requestId: string; choices: PasskeyChoice[] } | undefined> {
  for (const p of pending.values()) {
    if (
      p.tabId === tabId &&
      p.request.kind === "get" &&
      p.request.mediation === "conditional" &&
      vault.unlocked
    ) {
      const choices = await candidatesFor(p.rpId, p.request);
      if (choices.length > 0) {
        return { requestId: p.id, choices };
      }
    }
  }
  return undefined;
}

export function isConditionalForTab(requestId: string, tabId: number): boolean {
  const p = pending.get(requestId);
  return (
    p !== undefined &&
    p.tabId === tabId &&
    p.request.kind === "get" &&
    p.request.mediation === "conditional"
  );
}

export function registerWebAuthnListeners(ready: Promise<unknown>): void {
  chrome.runtime.onConnect.addListener((port) => {
    const sender = port.sender;
    if (
      port.name !== "webauthn" ||
      sender?.id !== chrome.runtime.id ||
      sender.tab?.id === undefined ||
      !/^https?:/.test(sender.url ?? "")
    ) {
      return;
    }
    let requestId: string | undefined;
    let done = false;
    const reply = (response: WebAuthnResponse) => {
      if (!done) {
        done = true;
        port.postMessage(response);
      }
    };
    port.onMessage.addListener(
      (message: { request?: unknown; fallbackSupported?: boolean; abort?: true }) => {
        if (message.abort) {
          if (requestId) {
            settle(requestId, fail("AbortError", "The operation was aborted"));
          }
          return;
        }
        if (message.request !== undefined && requestId === undefined) {
          const request = sanitizeRequest(message.request);
          if (!request) {
            reply(fail("TypeError", "Invalid request"));
            return;
          }
          void ready
            .then(() => begin(request, sender, message.fallbackSupported === true, reply))
            .then((id) => (requestId = id))
            .catch(() => reply(fail("NotAllowedError", "Request failed")));
        }
      },
    );
    port.onDisconnect.addListener(() => {
      if (requestId) {
        const p = pending.get(requestId);
        pending.delete(requestId);
        if (p?.windowId !== undefined) {
          void chrome.windows.remove(p.windowId).catch(() => undefined);
        }
      }
    });
  });

  chrome.windows.onRemoved.addListener((windowId) => {
    for (const p of pending.values()) {
      if (p.windowId === windowId) {
        p.windowId = undefined;
        settle(p.id, fail("NotAllowedError", "The user cancelled"));
      }
    }
  });
}
