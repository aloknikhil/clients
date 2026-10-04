import type { CipherListView } from "@bitwarden/sdk-internal";

import type { FillPlan, LoginFields } from "../content/autofill";
import { FillMode, type FillResult, type VaultItem } from "../lib/rpc";
import { uriMatches, type UriMatch } from "../lib/uri-match";

import { decryptCipher, totpCode } from "./ciphers";
import { copyToClipboard } from "./clipboard";
import { toVaultItem } from "./items";
import { getSettings } from "./settings";
import { vault } from "./vault";

const CONTENT_SCRIPT = "content/autofill.js";

function loginUris(cipher: CipherListView): { uri?: string; match?: number }[] {
  return typeof cipher.type === "object" && "login" in cipher.type
    ? (cipher.type.login.uris ?? [])
    : [];
}

function matchesUrl(uris: { uri?: string; match?: number }[], url: string): boolean {
  return uris.some((u) => uriMatches(u.uri, u.match as UriMatch | undefined, url));
}

async function tabUrl(tabId: number): Promise<string | undefined> {
  const tab = await chrome.tabs.get(tabId);
  return tab.url;
}

async function matchingCiphers(tabId: number): Promise<CipherListView[]> {
  const url = await tabUrl(tabId);
  if (url === undefined || !/^https?:/.test(url)) {
    return [];
  }
  const all = await vault.list();
  return all.filter((cipher) => matchesUrl(loginUris(cipher), url));
}

export async function ciphersForTab(tabId: number): Promise<VaultItem[]> {
  return (await matchingCiphers(tabId)).map(toVaultItem);
}

function origin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function hasFields(fields: LoginFields): boolean {
  return (
    fields.username !== undefined || fields.password !== undefined || fields.totp !== undefined
  );
}

/**
 * Fills a login into the tab.
 *
 * - Strict: a frame only receives values when its *own* URL matches one of the item's websites,
 *   so a cross-origin iframe on a matching page never gets the password, and an https-saved
 *   login is never filled into an http frame.
 * - Explicit (the user picked this item): also frames with the same origin as the page itself.
 *   Third-party iframes still get nothing. The result reports the mismatch so the popup can offer
 *   to save the site to the item.
 */
export async function autofill(
  tabId: number,
  cipherId: string,
  mode: FillMode,
): Promise<FillResult> {
  const cipher = await decryptCipher(cipherId);
  const login = cipher.login;
  if (login === undefined) {
    return { kind: "nothingToFill" };
  }
  const uris = login.uris ?? [];

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: [CONTENT_SCRIPT],
  });
  const frames = (
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => globalThis.__bwLiteAutofill?.collect(),
    })
  ).flatMap((f) => (f.result ? [{ frameId: f.frameId, fields: f.result as LoginFields }] : []));

  const top = frames.find((f) => f.frameId === 0)?.fields.url ?? (await tabUrl(tabId)) ?? "";
  const topOrigin = origin(top);
  const matching = (url: string) => matchesUrl(uris, url);
  const allowed = (url: string) =>
    matching(url) ||
    (mode !== FillMode.Strict && topOrigin !== undefined && origin(url) === topOrigin);

  const fillable = frames.filter((f) => hasFields(f.fields));
  if (fillable.length === 0) {
    return { kind: "nothingToFill" };
  }

  let filled = false;
  let totpFilled = false;
  for (const { frameId, fields } of fillable) {
    if (!allowed(fields.url)) {
      continue;
    }
    const insecure =
      matching(fields.url) &&
      fields.url.startsWith("http:") &&
      uris.some((u) => u.uri?.trim().toLowerCase().startsWith("https:"));
    const plan: FillPlan = {};
    if (fields.username !== undefined && login.username) {
      plan.username = { opid: fields.username, value: login.username };
    }
    if (fields.password !== undefined && login.password && !insecure) {
      plan.password = { opid: fields.password, value: login.password };
    }
    const totp = fields.totp === undefined ? undefined : totpCode(cipher);
    if (fields.totp !== undefined && totp !== undefined) {
      plan.totp = { opid: fields.totp, value: totp };
    }
    if (Object.keys(plan).length === 0) {
      continue;
    }
    const [result] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (p: FillPlan) => globalThis.__bwLiteAutofill?.fill(p) ?? false,
      args: [plan],
    });
    if (result?.result === true) {
      filled = true;
      totpFilled ||= plan.totp !== undefined;
    }
  }
  if (!filled) {
    return { kind: "nothingToFill" };
  }

  // The site's 2FA step usually comes next: have the code ready to paste.
  let totpCopied = false;
  if (!totpFilled && login.totp && (await getSettings()).copyTotpOnFill) {
    const code = totpCode(cipher);
    if (code) {
      await copyToClipboard(code);
      totpCopied = true;
    }
  }
  const unmatched =
    topOrigin !== undefined && !matching(top)
      ? { origin: topOrigin, host: new URL(top).host, canSave: cipher.edit }
      : undefined;
  return { kind: "filled", totpCopied, unmatched };
}

/** Keyboard shortcut / context menu: fill the first matching login that doesn't need a reprompt. */
export async function autofillActiveTab(): Promise<boolean> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !vault.unlocked) {
    return false;
  }
  const match = (await matchingCiphers(tab.id)).find((c) => c.reprompt === 0);
  if (match?.id === undefined) {
    return false;
  }
  return (await autofill(tab.id, String(match.id), FillMode.Strict)).kind === "filled";
}
