/**
 * Inline autofill menu. Registered on http(s) pages only while the setting is on.
 *
 * This script never sees vault data: it asks the service worker for a lock state and a match
 * count for its own tab, and if there is something to show it embeds the extension's menu page
 * in an iframe under the focused field. The iframe is extension-origin (the page can't read or
 * script it) and lives in a closed shadow root (page CSS can't restyle it).
 */

const USERNAME_HINT = /user|email|login|account|identifier|e-mail/i;
const TEXT_TYPES = new Set(["text", "email", "tel", ""]);
const MENU_WIDTH = 320;
const ROW_HEIGHT = 48;
const CHROME_HEIGHT = 38;
const SEARCH_HEIGHT = 44;

let host: HTMLElement | undefined;
let frame: HTMLIFrameElement | undefined;
let anchor: HTMLInputElement | undefined;
let raf = 0;
let menuNonce: string | undefined;

function hints(input: HTMLInputElement): string {
  return [
    input.name,
    input.id,
    input.autocomplete,
    input.placeholder,
    input.getAttribute("aria-label") ?? "",
  ].join(" ");
}

function isLoginField(target: EventTarget | null): target is HTMLInputElement {
  if (
    !(target instanceof HTMLInputElement) ||
    target.disabled ||
    target.readOnly ||
    target.hasAttribute("data-bwignore")
  ) {
    return false;
  }
  if (target.type === "password") {
    return target.autocomplete !== "new-password";
  }
  if (!TEXT_TYPES.has(target.type.toLowerCase())) {
    return false;
  }
  if (target.autocomplete === "username" || target.autocomplete === "email") {
    return true;
  }
  // A username-ish field on a page that has (or is about to show) a sign-in form.
  const scope = target.form ?? document;
  return (
    USERNAME_HINT.test(hints(target)) &&
    (scope.querySelector('input[type="password"]') !== null || target.form !== null)
  );
}

function position(): void {
  if (!host || !anchor) {
    return;
  }
  if (!anchor.isConnected) {
    close();
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const height = frame ? parseFloat(frame.style.height) : 0;
  const below = rect.bottom + 6;
  const top =
    below + height > innerHeight && rect.top - height - 6 > 0 ? rect.top - height - 6 : below;
  const left = Math.max(8, Math.min(rect.left, innerWidth - MENU_WIDTH - 8));
  // top/left rather than a transform: a transformed layer can be rasterized off the pixel grid,
  // which blurs the menu's text.
  host.style.left = `${Math.round(left)}px`;
  host.style.top = `${Math.round(top)}px`;
}

function schedulePosition(): void {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(position);
}

function close(): void {
  menuNonce = undefined;
  host?.remove();
  host = undefined;
  frame = undefined;
  anchor = undefined;
  removeEventListener("scroll", schedulePosition, true);
  removeEventListener("resize", schedulePosition);
}

async function open(input: HTMLInputElement): Promise<void> {
  if (anchor === input && host) {
    return;
  }
  // The nonce proves to the service worker that this menu was opened by us: it only exists here
  // and in the src of an iframe inside a closed shadow root.
  const nonce = crypto.randomUUID();
  let probe: { locked: boolean; count: number; passkeys: number } | undefined;
  try {
    probe = await chrome.runtime.sendMessage({ inline: "probe", nonce });
  } catch {
    return; // Extension reloaded or disabled.
  }
  if (!probe || document.activeElement !== input) {
    return;
  }
  close();
  anchor = input;
  menuNonce = nonce;
  // Initial guess; the menu reports its real height once rendered.
  const rows = probe.locked ? 1 : Math.max(1, Math.min(probe.count + probe.passkeys, 5));

  host = document.createElement("div");
  host.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;z-index:2147483647;margin:0;padding:0;border:0;width:auto;height:auto;";
  const shadow = host.attachShadow({ mode: "closed" });
  frame = document.createElement("iframe");
  frame.src = `${chrome.runtime.getURL("inline/menu.html")}#${nonce}`;
  frame.title = "Autofill";
  frame.setAttribute("allow", "");
  // Text quality: an iframe with rounded corners gets a masked compositing layer, and a transparent
  // one has no opaque surface under its text; both make Chrome fall back to blurrier anti-aliasing.
  // So: square corners and an opaque background matching the menu surface.
  const surface = matchMedia("(prefers-color-scheme: light)").matches ? "#f7f7f7" : "#131519";
  frame.style.cssText = `display:block;width:${MENU_WIDTH}px;height:${CHROME_HEIGHT + (probe.locked ? 0 : SEARCH_HEIGHT) + rows * ROW_HEIGHT}px;border:0;border-radius:0;color-scheme:normal;background:${surface};box-shadow:0 1px 1px #00000014,0 4px 8px -4px #00000033,0 16px 24px -8px #0000004d;`;
  shadow.append(frame);
  document.documentElement.append(host);
  position();
  addEventListener("scroll", schedulePosition, true);
  addEventListener("resize", schedulePosition);
}

document.addEventListener(
  "focusin",
  (e) => {
    if (isLoginField(e.target)) {
      void open(e.target);
    }
  },
  true,
);

document.addEventListener(
  "pointerdown",
  (e) => {
    if (host && e.target !== host && e.target !== anchor) {
      close();
    }
  },
  true,
);

document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && host) {
      close();
    }
  },
  true,
);

document.addEventListener(
  "focusout",
  (e) => {
    // Clicking into the menu moves focus to its host; anything else closes it.
    if (e.target === anchor) {
      setTimeout(() => {
        if (document.activeElement !== host && document.activeElement !== anchor) {
          close();
        }
      }, 150);
    }
  },
  true,
);

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id !== chrome.runtime.id) {
    return;
  }
  const m = message as { inline?: string; nonce?: string; height?: number };
  if (m?.inline === "close") {
    close();
  } else if (
    m?.inline === "resize" &&
    frame &&
    m.nonce === menuNonce &&
    typeof m.height === "number"
  ) {
    frame.style.height = `${Math.round(m.height)}px`;
    position();
  }
});
