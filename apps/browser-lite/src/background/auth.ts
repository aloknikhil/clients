import type { PasswordPreloginResponse } from "@bitwarden/sdk-internal";

import { ApiError, apiRequest, identityToken, setTokens, tokensFromResponse } from "../lib/api";
import { masterPasswordAuthHash } from "../lib/auth-hash";
import { CLIENT_NAME, DEVICE_TYPE, deviceIdentifier, deviceName } from "../lib/device";
import { prop } from "../lib/props";
import { TwoFactorProvider, type LoginResult } from "../lib/rpc";

import {
  accountCryptographicStateFromResponse,
  getAccount,
  kdfFromResponse,
  setAccount,
  userIdFromAccessToken,
  type Account,
} from "./account";
import { clearStateBridge } from "./state-bridge";
import { fullSync } from "./sync";
import { anonymousClient, vault } from "./vault";

/**
 * In-progress login between the password step and a 2FA / new-device challenge. Kept in
 * memory-only session storage so a service worker restart mid-login doesn't lose it.
 */
interface PendingLogin {
  email: string;
  password: string;
  authHash: string;
  prelogin: PasswordPreloginResponse;
  /** Set when the server asked for a second factor, re-sent with the new-device OTP. */
  twoFactor?: Record<string, string>;
  expiresAt: number;
}

const PENDING_KEY = "pendingLogin";
const PENDING_TTL_MS = 5 * 60 * 1000;
/** Server `TwoFactorProviderType.Remember`. */
const REMEMBER_PROVIDER = 5;
const NEW_DEVICE_VERIFICATION_REQUIRED = "new device verification required";

function rememberKey(email: string): string {
  return `twoFactorRemember:${email.toLowerCase()}`;
}

async function getPending(): Promise<PendingLogin> {
  const pending = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] as
    PendingLogin | undefined;
  if (pending === undefined || pending.expiresAt < Date.now()) {
    await chrome.storage.session.remove(PENDING_KEY);
    throw new Error("Login session expired. Start again.");
  }
  return pending;
}

async function setPending(pending: PendingLogin | undefined): Promise<void> {
  if (pending === undefined) {
    await chrome.storage.session.remove(PENDING_KEY);
  } else {
    await chrome.storage.session.set({ [PENDING_KEY]: pending });
  }
}

export async function login(email: string, password: string): Promise<LoginResult> {
  email = email.trim();
  const client = await anonymousClient();
  let prelogin: PasswordPreloginResponse;
  try {
    prelogin = await client.auth().login().get_password_prelogin(email);
  } finally {
    client.free();
  }
  const pending: PendingLogin = {
    email,
    password,
    authHash: await masterPasswordAuthHash(password, prelogin.salt, prelogin.kdf),
    prelogin,
    expiresAt: Date.now() + PENDING_TTL_MS,
  };
  await setPending(pending);

  const remembered = (await chrome.storage.local.get(rememberKey(email)))[rememberKey(email)] as
    string | undefined;
  const extra: Record<string, string> =
    remembered === undefined
      ? {}
      : {
          twoFactorToken: remembered,
          twoFactorProvider: String(REMEMBER_PROVIDER),
          twoFactorRemember: "0",
        };
  return requestToken(pending, extra);
}

export async function loginTwoFactor(
  provider: TwoFactorProvider,
  token: string,
  remember: boolean,
): Promise<LoginResult> {
  const pending = await getPending();
  pending.twoFactor = {
    twoFactorToken: token.trim(),
    twoFactorProvider: String(provider),
    twoFactorRemember: remember ? "1" : "0",
  };
  await setPending(pending);
  return requestToken(pending, pending.twoFactor);
}

export async function loginNewDevice(otp: string): Promise<LoginResult> {
  const pending = await getPending();
  return requestToken(pending, { ...pending.twoFactor, newDeviceOtp: otp.trim() });
}

export async function sendTwoFactorEmail(): Promise<void> {
  const pending = await getPending();
  await apiRequest("POST", "/two-factor/send-email-login", {
    authenticated: false,
    body: {
      email: pending.email,
      masterPasswordHash: pending.authHash,
      deviceIdentifier: await deviceIdentifier(),
    },
  });
}

async function requestToken(
  pending: PendingLogin,
  extra: Record<string, string>,
): Promise<LoginResult> {
  const { status, body } = await identityToken({
    scope: "api offline_access",
    client_id: CLIENT_NAME,
    deviceType: String(DEVICE_TYPE),
    deviceIdentifier: await deviceIdentifier(),
    deviceName: deviceName(),
    grant_type: "password",
    username: pending.email,
    password: pending.authHash,
    ...extra,
  });

  if (status === 200) {
    await completeLogin(pending, body);
    return { kind: "success" };
  }

  const providers = prop<Record<string, unknown>>(body, "TwoFactorProviders2");
  if (status === 400 && providers != null && Object.keys(providers).length > 0) {
    // A stale remembered token gets rejected with a fresh challenge; forget it.
    if (extra.twoFactorProvider === String(REMEMBER_PROVIDER)) {
      await chrome.storage.local.remove(rememberKey(pending.email));
    }
    const known = new Set<number>(Object.values(TwoFactorProvider));
    return {
      kind: "twoFactor",
      providers: Object.keys(providers)
        .map(Number)
        .filter((p): p is TwoFactorProvider => known.has(p)),
      providerData: providers,
    };
  }

  const errorMessage = prop<string>(prop(body, "ErrorModel"), "Message");
  if (status === 400 && errorMessage?.toLowerCase() === NEW_DEVICE_VERIFICATION_REQUIRED) {
    return { kind: "newDeviceVerification" };
  }
  if (status === 400 && prop(body, "SsoOrganizationIdentifier") != null) {
    return { kind: "error", message: "ssoRequired" };
  }
  return { kind: "error", message: errorMessage ?? new ApiError(status, body).message };
}

async function completeLogin(pending: PendingLogin, body: unknown): Promise<void> {
  const tokens = tokensFromResponse(body);
  const decryptionOptions = prop(body, "UserDecryptionOptions");
  const unlock = prop(decryptionOptions, "MasterPasswordUnlock");
  const accountCryptographicState = accountCryptographicStateFromResponse(
    prop(body, "AccountKeys"),
    prop(body, "PrivateKey"),
  );
  const masterKeyWrappedUserKey =
    prop<string>(unlock, "MasterKeyEncryptedUserKey") ?? prop<string>(body, "Key");
  if (accountCryptographicState === undefined || masterKeyWrappedUserKey === undefined) {
    // SSO / trusted-device / key-connector accounts have no master password unlock path yet.
    throw new Error("This account type isn't supported yet.");
  }

  const account: Account = {
    userId: userIdFromAccessToken(tokens.accessToken),
    email: pending.email,
    kdf: kdfFromResponse(prop(unlock, "Kdf")) ?? pending.prelogin.kdf,
    salt: prop<string>(unlock, "Salt") ?? pending.prelogin.salt,
    masterKeyWrappedUserKey,
    accountCryptographicState,
    organizationKeys: {},
  };

  await setTokens(tokens);
  await setAccount(account);
  const rememberToken = prop<string>(body, "TwoFactorToken");
  if (rememberToken) {
    await chrome.storage.local.set({ [rememberKey(pending.email)]: rememberToken });
  }

  await vault.unlock(account, masterPasswordUnlockMethod(account, pending.password));
  await setPending(undefined);
  await fullSync();
}

export function masterPasswordUnlockMethod(account: Account, password: string) {
  return {
    masterPasswordUnlock: {
      password,
      master_password_unlock: {
        kdf: account.kdf,
        masterKeyWrappedUserKey: account.masterKeyWrappedUserKey as never,
        salt: account.salt,
      },
    },
  };
}

export async function logout(): Promise<void> {
  const account = await getAccount();
  await vault.clear();
  if (account !== undefined) {
    await clearStateBridge(account.userId);
  }
  await setTokens(undefined);
  await setAccount(undefined);
  await setPending(undefined);
  await chrome.storage.local.remove("lastSync");
}
