/**
 * Isolated-world relay between the page hook and the service worker. It forwards opaque requests
 * over a port; the service worker validates them and learns the origin from Chrome, not from here.
 */
import type { WebAuthnResponse } from "../lib/webauthn";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FALLBACK: WebAuthnResponse = { ok: false, fallback: true };

document.addEventListener("bwlite-webauthn-request", (event) => {
  const detail = (event as CustomEvent).detail;
  if (typeof detail !== "string") {
    return;
  }
  let message: { id?: unknown; request?: unknown; fallbackSupported?: unknown };
  try {
    message = JSON.parse(detail);
  } catch {
    return;
  }
  const id = message.id;
  if (typeof id !== "string" || !ID.test(id)) {
    return;
  }
  document.dispatchEvent(new CustomEvent(`bwlite-webauthn-ack-${id}`));

  let replied = false;
  const reply = (response: WebAuthnResponse) => {
    if (!replied) {
      replied = true;
      document.dispatchEvent(
        new CustomEvent(`bwlite-webauthn-response-${id}`, { detail: JSON.stringify(response) }),
      );
    }
  };

  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connect({ name: "webauthn" });
  } catch {
    reply(FALLBACK); // Extension reloaded: let the browser handle it.
    return;
  }
  const onAbort = (e: Event) => {
    if ((e as CustomEvent).detail === id) {
      port.postMessage({ abort: true });
    }
  };
  document.addEventListener("bwlite-webauthn-abort", onAbort);
  port.onMessage.addListener((response: WebAuthnResponse) => {
    reply(response);
    document.removeEventListener("bwlite-webauthn-abort", onAbort);
    port.disconnect();
  });
  port.onDisconnect.addListener(() => {
    document.removeEventListener("bwlite-webauthn-abort", onAbort);
    reply(FALLBACK);
  });
  port.postMessage({
    request: message.request,
    fallbackSupported: message.fallbackSupported === true,
  });
});
