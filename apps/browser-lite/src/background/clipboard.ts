import { getSettings } from "./settings";

const OFFSCREEN_URL = "offscreen/index.html";
const CLEAR_ALARM = "clearClipboard";

let creating: Promise<void> | undefined;

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (contexts.length > 0) {
    return;
  }
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: "Copy vault values and clear them after the configured delay",
    })
    .finally(() => (creating = undefined));
  await creating;
}

async function write(text: string): Promise<void> {
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ offscreen: "copy", text });
}

/** Copies text and schedules a clear according to the user's clipboard setting. */
export async function copyToClipboard(text: string): Promise<void> {
  await write(text);
  const { clearClipboardSeconds } = await getSettings();
  if (clearClipboardSeconds !== null) {
    // Alarms survive the service worker being suspended; setTimeout does not.
    await chrome.alarms.create(CLEAR_ALARM, { when: Date.now() + clearClipboardSeconds * 1000 });
  }
}

export function registerClipboardListeners(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CLEAR_ALARM) {
      void write("");
    }
  });
}
