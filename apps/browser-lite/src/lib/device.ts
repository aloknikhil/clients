/** Matches `DeviceType.ChromeExtension` on the server. */
export const DEVICE_TYPE = 2;
export const CLIENT_NAME = "browser";
export const CLIENT_VERSION = chrome.runtime.getManifest().version;

const KEY = "deviceIdentifier";

/** Stable per-install identifier the server uses for new-device verification and push. */
export async function deviceIdentifier(): Promise<string> {
  const stored = await chrome.storage.local.get(KEY);
  let id = stored[KEY] as string | undefined;
  if (id === undefined) {
    id = crypto.randomUUID();
    await chrome.storage.local.set({ [KEY]: id });
  }
  return id;
}

export function deviceName(): string {
  return "chrome";
}
