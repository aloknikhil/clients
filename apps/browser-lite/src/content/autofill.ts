/**
 * Injected on demand (never on page load) into the frames of the active tab. Runs in the
 * extension's isolated world and exposes a tiny API on `globalThis` that the service worker
 * calls through `chrome.scripting.executeScript`. It never sees the vault: the service worker
 * decides what to fill and sends only the values for this frame.
 */

export interface LoginFields {
  url: string;
  username?: number;
  password?: number;
  totp?: number;
}

export interface FillPlan {
  username?: { opid: number; value: string };
  password?: { opid: number; value: string };
  totp?: { opid: number; value: string };
}

interface LiteAutofill {
  collect(): LoginFields;
  fill(plan: FillPlan): boolean;
}

declare global {
  var __bwLiteAutofill: LiteAutofill | undefined;
}

const TEXT_TYPES = new Set(["text", "email", "tel", "url", "search", ""]);
const USERNAME_HINT = /user|email|login|account|identifier|e-mail/i;
const TOTP_HINT =
  /otp|totp|2fa|mfa|one.?time|verification.?code|security.?code|auth.?code|\bcode\b/i;

/** Elements discovered by the last `collect()`, addressed by index ("opid"). */
let elements: HTMLInputElement[] = [];

function allInputs(root: Document | ShadowRoot, out: HTMLInputElement[] = []): HTMLInputElement[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const element = node as Element;
    if (element instanceof HTMLInputElement) {
      out.push(element);
    }
    if (element.shadowRoot) {
      allInputs(element.shadowRoot, out);
    }
  }
  return out;
}

function usable(input: HTMLInputElement): boolean {
  if (input.disabled || input.readOnly || input.hasAttribute("data-bwignore")) {
    return false;
  }
  const style = getComputedStyle(input);
  if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) {
    return false;
  }
  const rect = input.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

function hints(input: HTMLInputElement): string {
  return [
    input.name,
    input.id,
    input.autocomplete,
    input.placeholder,
    input.getAttribute("aria-label") ?? "",
  ].join(" ");
}

function isTextLike(input: HTMLInputElement): boolean {
  return TEXT_TYPES.has(input.type.toLowerCase());
}

function collect(): LoginFields {
  elements = allInputs(document).filter(usable);
  const indexOf = (input: HTMLInputElement | undefined) =>
    input === undefined ? undefined : elements.indexOf(input);

  const passwords = elements.filter(
    (input) => input.type === "password" && input.autocomplete !== "new-password",
  );
  const password = passwords[0];

  let username: HTMLInputElement | undefined;
  if (password !== undefined) {
    // The username is the closest text field before the password, preferring the same form.
    const before = elements.slice(0, elements.indexOf(password)).filter(isTextLike).reverse();
    username = before.find((input) => input.form === password.form) ?? before[0];
  } else {
    // Username-first (multi-step) login pages.
    username =
      elements.find(
        (input) => input.autocomplete === "username" || input.autocomplete === "email",
      ) ?? elements.find((input) => isTextLike(input) && USERNAME_HINT.test(hints(input)));
  }

  const totp =
    elements.find((input) => input.autocomplete === "one-time-code") ??
    (password === undefined && username === undefined
      ? elements.find((input) => isTextLike(input) && TOTP_HINT.test(hints(input)))
      : undefined);

  return {
    url: location.href,
    username: indexOf(username),
    password: indexOf(password),
    totp: indexOf(totp),
  };
}

/** Sets a value the way a user would, so framework-controlled inputs (React, Vue) see it. */
function setValue(input: HTMLInputElement, value: string): void {
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  for (const type of ["keydown", "keypress", "input", "keyup", "change"]) {
    const event = type.startsWith("key")
      ? new KeyboardEvent(type, { bubbles: true, cancelable: true })
      : new Event(type, { bubbles: true });
    input.dispatchEvent(event);
  }
  input.blur();
}

function fill(plan: FillPlan): boolean {
  let filled = false;
  for (const entry of [plan.username, plan.password, plan.totp]) {
    const input = entry === undefined ? undefined : elements[entry.opid];
    if (entry !== undefined && input?.isConnected) {
      setValue(input, entry.value);
      filled = true;
    }
  }
  return filled;
}

globalThis.__bwLiteAutofill ??= { collect, fill };
