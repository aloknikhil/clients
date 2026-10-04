import jsQR from "jsqr";

import type { TotpResponse } from "@bitwarden/sdk-internal";

import { vault } from "./vault";

/** Live code for a secret or otpauth:// URI the user is typing; undefined while it's invalid. */
export function previewTotp(key: string): TotpResponse | undefined {
  if (key.trim() === "") {
    return undefined;
  }
  try {
    return vault.sdk().vault().totp().generate_totp(key.trim());
  } catch {
    return undefined;
  }
}

/**
 * Looks for an authenticator QR code on the visible part of the tab, like 1Password's "scan
 * from screen". The screenshot is decoded in memory and discarded; only an otpauth:// URI
 * is returned, never the image.
 */
export async function scanTotpQr(tabId: number): Promise<string | undefined> {
  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
  return code?.data.startsWith("otpauth://") ? code.data : undefined;
}
