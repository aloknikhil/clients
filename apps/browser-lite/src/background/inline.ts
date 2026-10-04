import { getEnvironment, urlsFor } from "../lib/env";
import { FillMode, ItemKind } from "../lib/rpc";

import { autofill, ciphersForTab } from "./autofill";
import { conditionalChoices, isConditionalForTab, respond as respondToWebAuthn } from "./fido2";
import { toVaultItem } from "./items";
import { getSettings } from "./settings";
import { vault } from "./vault";

const SCRIPT_ID = "inline-menu";
export const MENU_PATH = "/inline/";

/** Content-script requests: lock state and counts, never item data. Registers the menu's nonce. */
export interface InlineProbe {
  inline: "probe";
  nonce: string;
}
export interface InlineProbeResult {
  locked: boolean;
  count: number;
  passkeys: number;
}

/** Requests from the menu iframe. Every one must carry the nonce its content script registered. */
export type InlineMenuRequest = { nonce: string } & (
  | { inlineMenu: "items" }
  | { inlineMenu: "fill"; id: string }
  | { inlineMenu: "passkey"; requestId: string; cipherId: string }
  | { inlineMenu: "resize"; height: number }
  | { inlineMenu: "close" }
  | { inlineMenu: "openPopup" }
);

const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSION_TTL_MS = 30 * 60 * 1000;
/**
 * Nonces of menus our content script actually opened, per tab. The nonce only exists in the
 * isolated world and in the src of an iframe inside a closed shadow root, so a page that embeds
 * the menu page itself can't produce one: such a menu gets nothing.
 */
const sessions = new Map<number, Map<string, number>>();

function registerSession(tabId: number, nonce: string): void {
  const now = Date.now();
  const tab = sessions.get(tabId) ?? new Map<string, number>();
  for (const [n, created] of tab) {
    if (now - created > SESSION_TTL_MS) {
      tab.delete(n);
    }
  }
  tab.set(nonce, now);
  sessions.set(tabId, tab);
}

function validSession(tabId: number, nonce: unknown): boolean {
  const created = typeof nonce === "string" ? sessions.get(tabId)?.get(nonce) : undefined;
  return created !== undefined && Date.now() - created < SESSION_TTL_MS;
}

const WEBAUTHN_IDS = ["webauthn-page", "webauthn-bridge"];

/** Registers or removes the optional content scripts to match the settings. */
export async function syncInlineMenuRegistration(): Promise<void> {
  const { inlineMenu, passkeys } = await getSettings();
  const registered = new Set(
    (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id),
  );
  const web = ["https://*/*", "http://*/*"];

  if (inlineMenu && !registered.has(SCRIPT_ID)) {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        js: ["content/inline.js"],
        matches: web,
        allFrames: true,
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
  } else if (!inlineMenu && registered.has(SCRIPT_ID)) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }

  // Passkeys: the hook must run in the page's world before site code, hence MAIN at document_start.
  // WebAuthn needs https (localhost excepted), so plain http pages are not touched.
  const passkeyMatches = ["https://*/*", "http://localhost/*"];
  const haveWebAuthn = WEBAUTHN_IDS.every((id) => registered.has(id));
  if (passkeys && !haveWebAuthn) {
    // Clear a half-registered pair first. Never pass an empty list: Chrome treats `ids: []` as
    // "unregister everything", which silently dropped the inline menu.
    const stale = WEBAUTHN_IDS.filter((id) => registered.has(id));
    if (stale.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: stale });
    }
    await chrome.scripting.registerContentScripts([
      {
        id: "webauthn-page",
        js: ["content/webauthn-page.js"],
        matches: passkeyMatches,
        allFrames: true,
        runAt: "document_start",
        world: "MAIN",
        persistAcrossSessions: true,
      },
      {
        id: "webauthn-bridge",
        js: ["content/webauthn-bridge.js"],
        matches: passkeyMatches,
        allFrames: true,
        runAt: "document_start",
        persistAcrossSessions: true,
      },
    ]);
  } else if (!passkeys && WEBAUTHN_IDS.some((id) => registered.has(id))) {
    await chrome.scripting.unregisterContentScripts({
      ids: WEBAUTHN_IDS.filter((id) => registered.has(id)),
    });
  }
}

function isProbe(message: unknown): message is InlineProbe {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as InlineProbe).inline === "probe" &&
    NONCE.test(String((message as InlineProbe).nonce))
  );
}

function isMenuRequest(message: unknown): message is InlineMenuRequest {
  return typeof message === "object" && message !== null && "inlineMenu" in message;
}

/** The menu page, embedded in a site's tab. Chrome sets `sender`; the page can't spoof it. */
function fromMenu(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.tab?.id !== undefined &&
    sender.url?.startsWith(chrome.runtime.getURL(MENU_PATH)) === true
  );
}

/** A content script of ours running in a web page. */
function fromContentScript(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.tab?.id !== undefined &&
    /^https?:/.test(sender.url ?? "")
  );
}

async function closeMenus(tabId: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { inline: "close" }).catch(() => undefined);
}

async function handleMenu(request: InlineMenuRequest, tabId: number): Promise<unknown> {
  switch (request.inlineMenu) {
    case "items": {
      if (!vault.unlocked) {
        return { locked: true, matches: [], all: [] };
      }
      const [matches, all, passkeys, settings] = await Promise.all([
        ciphersForTab(tabId),
        vault.list(),
        conditionalChoices(tabId),
        getSettings(),
      ]);
      const iconsBase = settings.showIcons ? urlsFor(await getEnvironment()).icons : undefined;
      return {
        locked: false,
        matches,
        // Searchable: every login. Only names/usernames/sites, rendered inside this isolated frame.
        all: all.map(toVaultItem).filter((i) => i.kind === ItemKind.Login),
        passkeys,
        iconsBase,
      };
    }
    case "fill": {
      if (!vault.unlocked) {
        return { kind: "nothingToFill" };
      }
      const all = (await vault.list()).map(toVaultItem);
      const item = all.find((c) => c.id === request.id && c.kind === ItemKind.Login);
      if (item === undefined || item.reprompt) {
        return { kind: "nothingToFill" };
      }
      // A match fills strictly; a search pick is an explicit choice (same-origin frames only).
      const matches = await ciphersForTab(tabId);
      const mode = matches.some((m) => m.id === item.id) ? FillMode.Strict : FillMode.Explicit;
      const result = await autofill(tabId, item.id, mode);
      await closeMenus(tabId);
      return result;
    }
    case "passkey": {
      if (!isConditionalForTab(request.requestId, tabId)) {
        return false;
      }
      await respondToWebAuthn(request.requestId, { cipherId: request.cipherId });
      await closeMenus(tabId);
      return true;
    }
    case "resize":
      await chrome.tabs
        .sendMessage(tabId, {
          inline: "resize",
          nonce: request.nonce,
          height: Math.max(40, Math.min(420, request.height)),
        })
        .catch(() => undefined);
      return true;
    case "openPopup":
      await closeMenus(tabId);
      await chrome.action.openPopup().catch(() => undefined);
      return true;
    default:
      await closeMenus(tabId);
      return true;
  }
}

export function registerInlineMenuListeners(ready: Promise<unknown>): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isProbe(message) && fromContentScript(sender)) {
      const tabId = sender.tab!.id!;
      registerSession(tabId, message.nonce);
      void ready.then(async () => {
        const locked = !vault.unlocked;
        const count = locked ? 0 : (await ciphersForTab(tabId)).length;
        const passkeys = locked ? 0 : ((await conditionalChoices(tabId))?.choices.length ?? 0);
        sendResponse({ locked, count, passkeys } satisfies InlineProbeResult);
      });
      return true;
    }
    if (isMenuRequest(message) && fromMenu(sender)) {
      const tabId = sender.tab!.id!;
      if (!validSession(tabId, message.nonce)) {
        sendResponse(undefined);
        return false;
      }
      void ready
        .then(() => handleMenu(message, tabId))
        .then(sendResponse, () => sendResponse(undefined));
      return true;
    }
    return false;
  });
  chrome.tabs.onRemoved.addListener((tabId) => sessions.delete(tabId));
  void syncInlineMenuRegistration();
}
