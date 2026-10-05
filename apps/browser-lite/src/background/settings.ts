import type { Settings } from "../lib/rpc";

const KEY = "settings";

export const DEFAULT_SETTINGS: Settings = {
  vaultTimeoutMinutes: 15,
  clearClipboardSeconds: 30,
  copyTotpOnFill: true,
  showIcons: true,
  inlineMenu: true,
  passkeys: true,
};

export async function getSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as
    (Partial<Settings> & { lockOnSystemIdle?: unknown }) | undefined;
  // `lockOnSystemIdle` was a separate switch that overrode the timeout (even "on browser restart").
  // It's now the "on system lock" timeout choice; the old flag is ignored.
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  delete settings.lockOnSystemIdle;
  return settings;
}

export async function setSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}
