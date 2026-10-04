import type { Settings } from "../lib/rpc";

const KEY = "settings";

export const DEFAULT_SETTINGS: Settings = {
  vaultTimeoutMinutes: 15,
  lockOnSystemIdle: true,
  clearClipboardSeconds: 30,
  copyTotpOnFill: true,
  showIcons: true,
  inlineMenu: true,
};

export async function getSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function setSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}
