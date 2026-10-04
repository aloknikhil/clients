import { apiRequest } from "../lib/api";
import { prop } from "../lib/props";

import { accountCryptographicStateFromResponse, getAccount, updateAccount } from "./account";
import { toSdkCipher, toSdkFolder, toSdkSend, type Json } from "./mapping";
import { repositories, vault } from "./vault";

const LAST_SYNC_KEY = "lastSync";

function byId<T>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [prop<string>(item, "id")!, item]));
}

export async function lastSync(): Promise<number | undefined> {
  return (await chrome.storage.local.get(LAST_SYNC_KEY))[LAST_SYNC_KEY] as number | undefined;
}

let inFlight: Promise<void> | undefined;

/** Full sync. Concurrent callers share one request. */
export function fullSync(): Promise<void> {
  inFlight ??= runSync().finally(() => (inFlight = undefined));
  return inFlight;
}

async function runSync(): Promise<void> {
  const response = await apiRequest<Json>("GET", "/sync?excludeDomains=true");
  const profile = prop(response, "profile");

  const organizationKeys: Record<string, string> = {};
  for (const org of prop<unknown[]>(profile, "organizations") ?? []) {
    const key = prop<string>(org, "key");
    if (key) {
      organizationKeys[prop<string>(org, "id")!] = key;
    }
  }
  const previous = await getAccount();
  const account = await updateAccount({
    organizationKeys,
    accountCryptographicState:
      accountCryptographicStateFromResponse(
        prop(profile, "accountKeys"),
        prop(profile, "privateKey"),
      ) ?? previous?.accountCryptographicState,
  });

  const ciphers = (prop<unknown[]>(response, "ciphers") ?? []).map(toSdkCipher);
  const folders = (prop<unknown[]>(response, "folders") ?? []).map(toSdkFolder);
  await Promise.all([
    repositories.ciphers.replaceAll(byId(ciphers)),
    repositories.folders.replaceAll(byId(folders)),
  ]);

  if (vault.unlocked) {
    const client = vault.sdk();
    await vault.initializeOrganizations(client, account);
    await client
      .crypto_sync_handler()
      .on_sync({ accountCryptographicState: account.accountCryptographicState });
    const sends = prop<unknown[]>(response, "sends") ?? [];
    await client.send_sync_handler().on_sync(sends.map(toSdkSend));
  }
  vault.invalidate();
  await chrome.storage.local.set({ [LAST_SYNC_KEY]: Date.now() });
}
