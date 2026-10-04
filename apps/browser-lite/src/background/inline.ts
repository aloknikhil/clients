import { getEnvironment, urlsFor } from "../lib/env";
import { FillMode, type VaultItem } from "../lib/rpc";

import { autofill, ciphersForTab } from "./autofill";
import { getSettings } from "./settings";
import { vault } from "./vault";

const SCRIPT_ID = "inline-menu";
export const MENU_PATH = "/inline/";

/** Content-script requests: only lock state and a match count, never item data. */
export interface InlineProbe {
  inline: "probe";
}
export interface InlineProbeResult {
  locked: boolean;
  count: number;
}

/** Requests from the menu iframe (an extension page embedded in the site). */
export type InlineMenuRequest =
  | { inlineMenu: "items" }
  | { inlineMenu: "fill"; id: string }
  | { inlineMenu: "close" }
  | { inlineMenu: "openPopup" };

/** Registers or removes the inline-menu content script to match the setting. */
export async function syncInlineMenuRegistration(): Promise<void> {
  const { inlineMenu } = await getSettings();
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (inlineMenu && registered.length === 0) {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        js: ["content/inline.js"],
        matches: ["https://*/*", "http://*/*"],
        allFrames: true,
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
  } else if (!inlineMenu && registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
}

function isProbe(message: unknown): message is InlineProbe {
  return (
    typeof message === "object" && message !== null && (message as InlineProbe).inline === "probe"
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
        return { locked: true, items: [] };
      }
      const items: VaultItem[] = await ciphersForTab(tabId);
      const settings = await getSettings();
      const iconsBase = settings.showIcons ? urlsFor(await getEnvironment()).icons : undefined;
      return { locked: false, items, iconsBase };
    }
    case "fill": {
      // Only items that match this tab can be filled from the page; reprompt items need the popup.
      const candidates = vault.unlocked ? await ciphersForTab(tabId) : [];
      const item = candidates.find((c) => c.id === request.id && !c.reprompt);
      if (item === undefined) {
        return { kind: "nothingToFill" };
      }
      const result = await autofill(tabId, item.id, FillMode.Strict);
      await closeMenus(tabId);
      return result;
    }
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
      void ready.then(async () => {
        const locked = !vault.unlocked;
        const count = locked ? 0 : (await ciphersForTab(sender.tab!.id!)).length;
        sendResponse({ locked, count } satisfies InlineProbeResult);
      });
      return true;
    }
    if (isMenuRequest(message) && fromMenu(sender)) {
      void ready
        .then(() => handleMenu(message, sender.tab!.id!))
        .then(sendResponse, () => sendResponse(undefined));
      return true;
    }
    return false;
  });
  void syncInlineMenuRegistration();
}
