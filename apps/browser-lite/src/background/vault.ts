import type {
  Cipher,
  CipherListView,
  ClientSettings,
  Folder,
  InitUserCryptoMethod,
  LocalUserDataKeyState,
  OrganizationSharedKey,
  Send,
} from "@bitwarden/sdk-internal";

import { accessToken, serverUrls } from "../lib/api";
import { CLIENT_VERSION, deviceIdentifier } from "../lib/device";
import { StorageRepository } from "../lib/repository";
import { ManagedSettingsClient, PasswordManagerClient, loadSdk } from "../lib/sdk";

import type { Account } from "./account";
import { createStateBridge } from "./state-bridge";

/**
 * Lives in `chrome.storage.session`: memory-only, never written to disk, and not readable by
 * content scripts. It lets the vault survive the service worker being suspended, which MV3
 * does after ~30s idle. Cleared on lock.
 */
const SESSION_USER_KEY = "userKey";

export const repositories = {
  ciphers: new StorageRepository<Cipher>("ciphers"),
  folders: new StorageRepository<Folder>("folders"),
  sends: new StorageRepository<Send>("sends"),
  localUserDataKey: new StorageRepository<LocalUserDataKeyState>("localUserDataKey"),
  organizationSharedKeys: new StorageRepository<OrganizationSharedKey>("organizationSharedKeys"),
};

async function clientSettings(): Promise<ClientSettings> {
  const urls = await serverUrls();
  return {
    apiUrl: urls.api,
    identityUrl: urls.identity,
    userAgent: navigator.userAgent,
    deviceType: "ChromeExtension",
    deviceIdentifier: await deviceIdentifier(),
    bitwardenClientVersion: CLIENT_VERSION,
  };
}

/** A client with no user: prelogin and other unauthenticated calls. */
export async function anonymousClient(): Promise<PasswordManagerClient> {
  await loadSdk();
  return new PasswordManagerClient(
    { get_access_token: async () => undefined },
    await clientSettings(),
    new ManagedSettingsClient(),
  );
}

class VaultSession {
  private client?: PasswordManagerClient;
  private listCache?: Promise<CipherListView[]>;

  get unlocked(): boolean {
    return this.client !== undefined;
  }

  /** The unlocked SDK client. Throws when locked so callers can't silently get empty data. */
  sdk(): PasswordManagerClient {
    if (this.client === undefined) {
      throw new Error("Vault is locked");
    }
    return this.client;
  }

  /** Re-unlocks after a service worker restart if the session still holds the user key. */
  async restore(account: Account | undefined): Promise<void> {
    if (account === undefined || this.client !== undefined) {
      return;
    }
    const stored = await chrome.storage.session.get(SESSION_USER_KEY);
    const userKey = stored[SESSION_USER_KEY] as string | undefined;
    if (userKey !== undefined) {
      await this.unlock(account, { decryptedKey: { decrypted_user_key: userKey } });
    }
  }

  /** Throws if the key material doesn't decrypt (wrong password/PIN). */
  async unlock(account: Account, method: InitUserCryptoMethod): Promise<void> {
    await loadSdk();
    const client = new PasswordManagerClient(
      { get_access_token: () => accessToken() },
      await clientSettings(),
      new ManagedSettingsClient(),
    );
    try {
      client.platform().state().register_client_managed_repositories({
        cipher: repositories.ciphers,
        folder: repositories.folders,
        send: repositories.sends,
        local_user_data_key_state: repositories.localUserDataKey,
        organization_shared_key: repositories.organizationSharedKeys,
      });
      client.km_state_bridge().register_bridge_impl(createStateBridge(account.userId));
      await client.crypto().initialize_user_crypto({
        userId: account.userId as never,
        email: account.email,
        kdfParams: account.kdf,
        accountCryptographicState: account.accountCryptographicState,
        method,
      });
      await this.initializeOrganizations(client, account);
    } catch (e) {
      client.free();
      throw e;
    }

    this.client?.free();
    this.client = client;
    this.listCache = undefined;
    // HAZMAT: the SDK permits exporting the user key only so clients can persist session unlock
    // state. It goes to memory-only session storage and nowhere else.
    await chrome.storage.session.set({
      [SESSION_USER_KEY]: await client.crypto().get_user_encryption_key(),
    });
  }

  /** Org keys change on sync (joined/left an org), so this is re-run after every sync. */
  async initializeOrganizations(client: PasswordManagerClient, account: Account): Promise<void> {
    const entries = Object.entries(account.organizationKeys);
    if (entries.length > 0) {
      await client.crypto().initialize_org_crypto({ organizationKeys: new Map(entries) as never });
    }
  }

  async lock(): Promise<void> {
    this.client?.free();
    this.client = undefined;
    this.listCache = undefined;
    await chrome.storage.session.remove(SESSION_USER_KEY);
  }

  /** Logout: drop keys and all cached vault data. */
  async clear(): Promise<void> {
    await this.lock();
    await Promise.all(Object.values(repositories).map((r) => r.removeAll()));
  }

  /** Decrypted list views (no secrets), cached until the next sync or lock. */
  /** Active (not trashed) items. */
  async list(): Promise<CipherListView[]> {
    return (await this.listAll()).filter((c) => c.deletedDate === undefined);
  }

  async trash(): Promise<CipherListView[]> {
    return (await this.listAll()).filter((c) => c.deletedDate !== undefined);
  }

  private listAll(): Promise<CipherListView[]> {
    const client = this.sdk();
    this.listCache ??= (async () => {
      const ciphers = await repositories.ciphers.list();
      return (await client.vault().ciphers().decrypt_list_with_failures(ciphers)).successes;
    })();
    this.listCache.catch(() => (this.listCache = undefined));
    return this.listCache;
  }

  invalidate(): void {
    this.listCache = undefined;
  }
}

export const vault = new VaultSession();
