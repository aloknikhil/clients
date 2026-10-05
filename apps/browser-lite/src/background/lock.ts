import { LockReason, VaultTimeout } from "../lib/rpc";

import { getSettings } from "./settings";
import { vault } from "./vault";

const ALARM = "vaultTimeout";
const LAST_ACTIVITY_KEY = "lastActivity";

/** Called on every popup interaction and fill. */
export async function recordActivity(): Promise<void> {
  if (vault.unlocked) {
    await chrome.storage.session.set({ [LAST_ACTIVITY_KEY]: Date.now() });
  }
}

async function checkTimeout(): Promise<void> {
  if (!vault.unlocked) {
    return;
  }
  const { vaultTimeoutMinutes } = await getSettings();
  // null = never; OnRestart (session storage handles it); OnSystemLock (handled by idle below).
  if (vaultTimeoutMinutes === null || vaultTimeoutMinutes <= VaultTimeout.OnRestart) {
    return;
  }
  const stored = await chrome.storage.session.get(LAST_ACTIVITY_KEY);
  const lastActivity = (stored[LAST_ACTIVITY_KEY] as number | undefined) ?? 0;
  if (Date.now() - lastActivity >= vaultTimeoutMinutes * 60_000) {
    await vault.lock(LockReason.Timeout);
  }
}

export function registerLockListeners(): void {
  void chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) {
      void checkTimeout();
    }
  });
  chrome.idle.onStateChanged.addListener((state) => {
    if (state !== "locked") {
      return;
    }
    // Only when the user chose "on system lock": it must not override "on browser restart".
    void getSettings().then((settings) => {
      if (settings.vaultTimeoutMinutes === VaultTimeout.OnSystemLock && vault.unlocked) {
        void vault.lock(LockReason.SystemLock);
      }
    });
  });
}
