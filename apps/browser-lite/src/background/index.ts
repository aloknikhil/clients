import { getEnvironment, setEnvironment } from "../lib/env";
import { AuthStatus, CopyableField, isRpcRequest, type Rpc, type RpcResponse } from "../lib/rpc";
import { PureCrypto, loadSdk } from "../lib/sdk";

import { getAccount, updateAccount } from "./account";
import {
  login,
  loginNewDevice,
  loginTwoFactor,
  logout,
  masterPasswordUnlockMethod,
  sendTwoFactorEmail,
} from "./auth";
import { autofill, autofillActiveTab, ciphersForTab } from "./autofill";
import { decryptCipher, totpCode } from "./ciphers";
import { copyToClipboard, registerClipboardListeners } from "./clipboard";
import {
  addUri,
  createFolder,
  deleteCipherForever,
  listFolders,
  restoreCipher,
  saveCipher,
  setFavorite,
  trashCipher,
} from "./edit";
import { MENU_PATH, registerInlineMenuListeners, syncInlineMenuRegistration } from "./inline";
import { toVaultItem } from "./items";
import { recordActivity, registerLockListeners } from "./lock";
import { getSettings, setSettings } from "./settings";
import { fullSync, lastSync } from "./sync";
import { previewTotp, scanTotpQr } from "./totp";
import { anonymousClient, vault } from "./vault";

type Handlers = { [M in keyof Rpc]: (...args: Parameters<Rpc[M]>) => Promise<ReturnType<Rpc[M]>> };

async function requireAccount() {
  const account = await getAccount();
  if (account === undefined) {
    throw new Error("Not logged in");
  }
  return account;
}

async function tryUnlock(run: () => Promise<void>): Promise<boolean> {
  try {
    await run();
  } catch {
    // Wrong password/PIN surfaces as a decrypt failure; never echo SDK error details.
    return false;
  }
  await recordActivity();
  void fullSync().catch(() => undefined);
  return true;
}

const handlers: Handlers = {
  async status() {
    const account = await getAccount();
    if (account === undefined) {
      return { buildId: __BUILD_ID__, status: AuthStatus.LoggedOut, pinEnabled: false };
    }
    return {
      buildId: __BUILD_ID__,
      status: vault.unlocked ? AuthStatus.Unlocked : AuthStatus.Locked,
      email: account.email,
      pinEnabled: account.pinProtectedUserKeyEnvelope !== undefined,
      lastSync: await lastSync(),
    };
  },
  getEnvironment,
  async setEnvironment(env) {
    if ((await getAccount()) !== undefined) {
      throw new Error("Log out before changing servers");
    }
    await setEnvironment(env);
  },

  login,
  loginTwoFactor,
  sendTwoFactorEmail,
  loginNewDevice,

  async unlockWithPassword(password) {
    const account = await requireAccount();
    return tryUnlock(() => vault.unlock(account, masterPasswordUnlockMethod(account, password)));
  },
  async verifyMasterPassword(password) {
    const account = await requireAccount();
    await loadSdk();
    try {
      PureCrypto.decrypt_user_key_with_master_password(
        account.masterKeyWrappedUserKey!,
        password,
        account.salt,
        account.kdf,
      ).fill(0);
      return true;
    } catch {
      return false;
    }
  },
  async unlockWithPin(pin) {
    const account = await requireAccount();
    const envelope = account.pinProtectedUserKeyEnvelope;
    if (envelope === undefined) {
      return false;
    }
    return tryUnlock(() =>
      vault.unlock(account, {
        pinEnvelope: { pin, pin_protected_user_key_envelope: envelope as never },
      }),
    );
  },
  async setPin(pin) {
    if (pin === null) {
      await updateAccount({ pinProtectedUserKeyEnvelope: undefined });
      return;
    }
    const { pinProtectedUserKeyEnvelope } = vault.sdk().crypto().enroll_pin(pin);
    await updateAccount({ pinProtectedUserKeyEnvelope });
  },
  async lock() {
    await vault.lock();
  },
  logout,

  async sync() {
    await fullSync();
  },
  async listCiphers() {
    return (await vault.list()).map(toVaultItem);
  },
  async listTrash() {
    return (await vault.trash()).map(toVaultItem);
  },
  saveCipher,
  setFavorite,
  trashCipher,
  restoreCipher,
  deleteCipherForever,
  async addSiteToItem(id, origin) {
    await addUri(id, origin);
  },
  listFolders,
  createFolder,
  async previewTotp(key) {
    return previewTotp(key);
  },
  scanTotpQr,
  async getCipher(id) {
    const cipher = await decryptCipher(id);
    // Org admins can hide passwords from members: autofill still works, viewing doesn't.
    if (!cipher.viewPassword && cipher.login !== undefined) {
      cipher.login = { ...cipher.login, password: undefined, totp: undefined };
    }
    return cipher;
  },
  async copyField(id, field) {
    const cipher = await decryptCipher(id);
    let value: string | undefined;
    if (field === CopyableField.Username) {
      value = cipher.login?.username;
    } else if (field === CopyableField.Password && cipher.viewPassword) {
      value = cipher.login?.password;
    } else if (field === CopyableField.Totp) {
      value = totpCode(cipher);
    }
    if (!value) {
      return false;
    }
    await copyToClipboard(value);
    return true;
  },
  async copyText(text) {
    await copyToClipboard(text);
  },
  async totp(id) {
    const key = (await decryptCipher(id)).login?.totp;
    return key ? vault.sdk().vault().totp().generate_totp(key) : undefined;
  },

  ciphersForTab,
  autofill,

  async generate(request) {
    const client = vault.unlocked ? vault.sdk() : await anonymousClient();
    try {
      return request.kind === "password"
        ? client.generator().password(request.options)
        : client.generator().passphrase(request.options);
    } finally {
      if (!vault.unlocked) {
        client.free();
      }
    }
  },

  getSettings,
  async setSettings(settings) {
    await setSettings(settings);
    await syncInlineMenuRegistration();
  },
};

/** Restores an unlocked session after the service worker was suspended. */
const ready = getAccount()
  .then((account) => vault.restore(account))
  .catch(() => undefined);

/**
 * Only our own extension pages may call in. Content scripts report the web page's URL, so the
 * origin check excludes them; `sender.tab` is not checked because the popup can be opened in a tab.
 */
function trustedSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.url?.startsWith(chrome.runtime.getURL("")) === true &&
    // The inline menu is an extension page embedded in websites: it gets its own narrow channel.
    !sender.url.startsWith(chrome.runtime.getURL(MENU_PATH))
  );
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRpcRequest(message) || !trustedSender(sender)) {
    return false;
  }
  const handler = handlers[message.rpc] as ((...args: unknown[]) => Promise<unknown>) | undefined;
  if (handler === undefined) {
    sendResponse({ ok: false, error: `Unknown method ${message.rpc}` } satisfies RpcResponse);
    return false;
  }
  void (async () => {
    try {
      await ready;
      const value = await handler(...message.args);
      void recordActivity();
      sendResponse({ ok: true, value } as RpcResponse);
    } catch (e) {
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      } satisfies RpcResponse);
    }
  })();
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  void ready.then(async () => {
    if (command === "autofill_login") {
      await autofillActiveTab();
    } else if (command === "generate_password") {
      const password = await handlers.generate({
        kind: "password",
        options: {
          length: 20,
          lowercase: true,
          uppercase: true,
          numbers: true,
          special: true,
          avoidAmbiguous: false,
          minLowercase: undefined,
          minUppercase: undefined,
          minNumber: 1,
          minSpecial: 1,
        },
      });
      await copyToClipboard(password);
    }
  });
});

registerInlineMenuListeners(ready);
registerLockListeners();
registerClipboardListeners();
