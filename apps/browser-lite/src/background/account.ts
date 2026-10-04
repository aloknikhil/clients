import type { Kdf, WrappedAccountCryptographicState } from "@bitwarden/sdk-internal";

import { prop } from "../lib/props";

/** Everything needed to unlock offline. Contains only wrapped (encrypted) key material. */
export interface Account {
  userId: string;
  email: string;
  kdf: Kdf;
  salt: string;
  masterKeyWrappedUserKey?: string;
  accountCryptographicState: WrappedAccountCryptographicState;
  /** Organization id -> org key encrypted to the user's public key. */
  organizationKeys: Record<string, string>;
  pinProtectedUserKeyEnvelope?: string;
}

const KEY = "account";

export async function getAccount(): Promise<Account | undefined> {
  return (await chrome.storage.local.get(KEY))[KEY] as Account | undefined;
}

export async function setAccount(account: Account | undefined): Promise<void> {
  if (account === undefined) {
    await chrome.storage.local.remove(KEY);
  } else {
    await chrome.storage.local.set({ [KEY]: account });
  }
}

export async function updateAccount(patch: Partial<Account>): Promise<Account> {
  const account = await getAccount();
  if (account === undefined) {
    throw new Error("Not logged in");
  }
  const updated = { ...account, ...patch };
  await setAccount(updated);
  return updated;
}

/** Server `KdfType`: 0 = PBKDF2-SHA256, 1 = Argon2id. */
export function kdfFromResponse(response: unknown): Kdf | undefined {
  const type = prop<number>(response, "KdfType") ?? prop<number>(response, "Kdf");
  const iterations =
    prop<number>(response, "Iterations") ?? prop<number>(response, "KdfIterations");
  if (type === undefined || iterations === undefined) {
    return undefined;
  }
  if (type === 1) {
    return {
      argon2id: {
        iterations,
        memory: (prop<number>(response, "Memory") ?? prop<number>(response, "KdfMemory"))!,
        parallelism: (prop<number>(response, "Parallelism") ??
          prop<number>(response, "KdfParallelism"))!,
      },
    };
  }
  return { pBKDF2: { iterations } };
}

/** Parses `AccountKeys` (V2) or falls back to the legacy bare `PrivateKey` (V1). */
export function accountCryptographicStateFromResponse(
  accountKeys: unknown,
  legacyPrivateKey: string | undefined,
): WrappedAccountCryptographicState | undefined {
  const encryptionPair = prop(accountKeys, "publicKeyEncryptionKeyPair");
  const privateKey = prop<string>(encryptionPair, "wrappedPrivateKey") ?? legacyPrivateKey;
  if (privateKey === undefined) {
    return undefined;
  }
  const signingKey = prop<string>(prop(accountKeys, "signatureKeyPair"), "wrappedSigningKey");
  const securityState = prop<string>(prop(accountKeys, "securityState"), "securityState");
  const signedPublicKey = prop<string>(encryptionPair, "signedPublicKey");
  if (signingKey !== undefined && securityState !== undefined && signedPublicKey !== undefined) {
    return {
      V2: {
        private_key: privateKey as never,
        signing_key: signingKey as never,
        signed_public_key: signedPublicKey as never,
        security_state: securityState as never,
      },
    };
  }
  return { V1: { private_key: privateKey as never } };
}

/** Reads the `sub` claim of an access token. The token is trusted: it came from our own login. */
export function userIdFromAccessToken(token: string): string {
  const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return (JSON.parse(atob(payload)) as { sub: string }).sub;
}
