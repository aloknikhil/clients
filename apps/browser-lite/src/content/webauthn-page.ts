/**
 * Runs in the page's own JavaScript world (MAIN) at document_start, so it can wrap
 * navigator.credentials before site code captures it. It holds no secrets: it marshals requests
 * to the isolated bridge and turns answers back into PublicKeyCredential objects. If the
 * extension doesn't acknowledge a request quickly, the browser's own WebAuthn is used.
 */
import {
  fromB64Url,
  toB64Url,
  type AssertionResult,
  type AttestationResult,
  type CreateRequest,
  type GetRequest,
  type WebAuthnRequest,
  type WebAuthnResponse,
} from "../lib/webauthn";

const ACK_TIMEOUT_MS = 1000;

(() => {
  if (typeof PublicKeyCredential === "undefined" || !navigator.credentials) {
    return;
  }
  const credentials = navigator.credentials;
  const nativeGet = credentials.get.bind(credentials);
  const nativeCreate = credentials.create.bind(credentials);

  const bytes = (source: BufferSource): Uint8Array =>
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const b64 = (source: BufferSource) => toB64Url(bytes(source));

  /** Resolves with the extension's answer, or `undefined` when the extension isn't there. */
  function send(
    request: WebAuthnRequest,
    signal?: AbortSignal | null,
  ): Promise<WebAuthnResponse | undefined> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      let acked = false;
      const cleanup = () => {
        document.removeEventListener(`bwlite-webauthn-ack-${id}`, onAck);
        document.removeEventListener(`bwlite-webauthn-response-${id}`, onResponse);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAck = () => (acked = true);
      const onResponse = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (typeof detail === "string") {
          cleanup();
          resolve(JSON.parse(detail) as WebAuthnResponse);
        }
      };
      const onAbort = () => {
        cleanup();
        document.dispatchEvent(new CustomEvent("bwlite-webauthn-abort", { detail: id }));
        reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      document.addEventListener(`bwlite-webauthn-ack-${id}`, onAck);
      document.addEventListener(`bwlite-webauthn-response-${id}`, onResponse);
      signal?.addEventListener("abort", onAbort);
      document.dispatchEvent(
        new CustomEvent("bwlite-webauthn-request", {
          detail: JSON.stringify({ id, request, fallbackSupported: true }),
        }),
      );
      setTimeout(() => {
        if (!acked) {
          cleanup();
          resolve(undefined);
        }
      }, ACK_TIMEOUT_MS);
    });
  }

  function toAssertion(r: AssertionResult): PublicKeyCredential {
    const credential = {
      id: r.credentialId,
      rawId: fromB64Url(r.credentialId).buffer,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        authenticatorData: fromB64Url(r.authenticatorData).buffer,
        clientDataJSON: fromB64Url(r.clientDataJSON).buffer,
        signature: fromB64Url(r.signature).buffer,
        userHandle: r.userHandle ? fromB64Url(r.userHandle).buffer : null,
      },
      getClientExtensionResults: () => ({}),
      toJSON: () => ({
        id: r.credentialId,
        rawId: r.credentialId,
        response: {
          clientDataJSON: r.clientDataJSON,
          authenticatorData: r.authenticatorData,
          signature: r.signature,
          userHandle: r.userHandle,
        },
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        type: "public-key",
      }),
    };
    // Same trick as the reference: make `instanceof` checks pass.
    Object.setPrototypeOf(credential.response, AuthenticatorAssertionResponse.prototype);
    Object.setPrototypeOf(credential, PublicKeyCredential.prototype);
    return credential as unknown as PublicKeyCredential;
  }

  function toAttestation(r: AttestationResult): PublicKeyCredential {
    const credential = {
      id: r.credentialId,
      rawId: fromB64Url(r.credentialId).buffer,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: fromB64Url(r.clientDataJSON).buffer,
        attestationObject: fromB64Url(r.attestationObject).buffer,
        getAuthenticatorData: () => fromB64Url(r.authData).buffer,
        getPublicKey: () => fromB64Url(r.publicKey).buffer,
        getPublicKeyAlgorithm: () => r.publicKeyAlgorithm,
        getTransports: () => r.transports,
      },
      getClientExtensionResults: () => (r.rk === undefined ? {} : { credProps: { rk: r.rk } }),
      toJSON: () => ({
        id: r.credentialId,
        rawId: r.credentialId,
        response: {
          clientDataJSON: r.clientDataJSON,
          authenticatorData: r.authData,
          transports: r.transports,
          publicKey: r.publicKey,
          publicKeyAlgorithm: r.publicKeyAlgorithm,
          attestationObject: r.attestationObject,
        },
        authenticatorAttachment: "platform",
        clientExtensionResults: r.rk === undefined ? {} : { credProps: { rk: r.rk } },
        type: "public-key",
      }),
    };
    Object.setPrototypeOf(credential.response, AuthenticatorAttestationResponse.prototype);
    Object.setPrototypeOf(credential, PublicKeyCredential.prototype);
    return credential as unknown as PublicKeyCredential;
  }

  function fail(response: Extract<WebAuthnResponse, { ok: false }>): never {
    const { error } = response as { error: { name: string; message: string } };
    if (error.name === "TypeError") {
      throw new TypeError(error.message);
    }
    throw new DOMException(error.message, error.name);
  }

  credentials.get = async function get(
    options?: CredentialRequestOptions,
  ): Promise<Credential | null> {
    const pk = options?.publicKey;
    // Every allowed credential lives on a security key (usb/nfc/ble only): nothing we hold can
    // answer, so go straight to the browser, as the reference does.
    const external =
      pk?.allowCredentials?.length &&
      pk.allowCredentials.every((c) => c.transports?.length && !c.transports.includes("internal"));
    if (!pk || external) {
      return nativeGet(options);
    }
    const request: GetRequest = {
      kind: "get",
      rpId: pk.rpId,
      challenge: b64(pk.challenge),
      allowCredentials: (pk.allowCredentials ?? []).map((c) => b64(c.id)),
      userVerification: pk.userVerification,
      mediation: options.mediation,
      timeout: pk.timeout,
    };

    if (options.mediation === "conditional") {
      // Passkey autofill: our inline menu and the browser's own UI both offer passkeys; whichever
      // the user picks wins and the other is aborted.
      const internal = new AbortController();
      options.signal?.addEventListener("abort", () => internal.abort(options.signal?.reason));
      const ours = send(request, internal.signal).then(
        (r) =>
          r?.ok ? toAssertion(r.result as AssertionResult) : new Promise<never>(() => undefined),
        () => new Promise<never>(() => undefined),
      );
      // The browser's side can fail on its own (another request pending, no platform authenticator);
      // that must not cancel ours. Only the site's own abort ends the race with an error.
      const native = nativeGet({ ...options, signal: internal.signal }).catch((error: unknown) => {
        if (options.signal?.aborted) {
          throw error;
        }
        return new Promise<never>(() => undefined);
      });
      try {
        return await Promise.race([native, ours]);
      } finally {
        internal.abort();
      }
    }

    const response = await send(request, options.signal);
    if (response === undefined || (!response.ok && "fallback" in response)) {
      return nativeGet(options);
    }
    return response.ok ? toAssertion(response.result as AssertionResult) : fail(response);
  };

  credentials.create = async function create(
    options?: CredentialCreationOptions,
  ): Promise<Credential | null> {
    const pk = options?.publicKey;
    if (!pk || (options as { mediation?: string }).mediation === "conditional") {
      return nativeCreate(options);
    }
    const request: CreateRequest = {
      kind: "create",
      rp: { id: pk.rp.id, name: pk.rp.name },
      user: { id: b64(pk.user.id), name: pk.user.name, displayName: pk.user.displayName },
      challenge: b64(pk.challenge),
      // Keycloak sends `alg` as a string; normalize like the reference.
      pubKeyCredParams: (pk.pubKeyCredParams ?? [])
        .map((p) => ({ type: p.type, alg: Number(p.alg) }))
        .filter((p) => !isNaN(p.alg)),
      excludeCredentials: (pk.excludeCredentials ?? []).map((c) => b64(c.id)),
      residentKey: pk.authenticatorSelection?.residentKey,
      requireResidentKey: pk.authenticatorSelection?.requireResidentKey,
      userVerification: pk.authenticatorSelection?.userVerification,
      credProps: pk.extensions?.credProps,
      timeout: pk.timeout,
    };
    const response = await send(request, options.signal);
    if (response === undefined || (!response.ok && "fallback" in response)) {
      return nativeCreate(options);
    }
    return response.ok ? toAttestation(response.result as AttestationResult) : fail(response);
  };
})();
