import type {
  CipherView,
  PassphraseGeneratorRequest,
  PasswordGeneratorRequest,
  TotpResponse,
} from "@bitwarden/sdk-internal";

import type { Environment } from "./env";

export const AuthStatus = Object.freeze({
  LoggedOut: "loggedOut",
  Locked: "locked",
  Unlocked: "unlocked",
} as const);
export type AuthStatus = (typeof AuthStatus)[keyof typeof AuthStatus];

/** Server `TwoFactorProviderType` values the popup knows how to prompt for. */
export const TwoFactorProvider = Object.freeze({
  Authenticator: 0,
  Email: 1,
  Duo: 2,
  Yubikey: 3,
  OrganizationDuo: 6,
  WebAuthn: 7,
} as const);
export type TwoFactorProvider = (typeof TwoFactorProvider)[keyof typeof TwoFactorProvider];

export type LoginResult =
  | { kind: "success" }
  | { kind: "twoFactor"; providers: TwoFactorProvider[]; providerData: Record<string, unknown> }
  | { kind: "newDeviceVerification" }
  | { kind: "error"; message: string };

export const ItemKind = Object.freeze({
  Login: "login",
  Note: "note",
  Card: "card",
  Identity: "identity",
  SshKey: "sshKey",
  Other: "other",
} as const);
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind];

/**
 * What the popup may know about an item without opening it. Built from an explicit allowlist in
 * the service worker: the SDK's list view also carries notes, custom fields and the TOTP seed,
 * none of which belong in a list.
 */
export interface VaultItem {
  id: string;
  name: string;
  subtitle: string;
  kind: ItemKind;
  favorite: boolean;
  reprompt: boolean;
  viewPassword: boolean;
  folderId?: string;
  organizationId?: string;
  /** Saved website addresses, for search and display. */
  uris: string[];
  hasUsername: boolean;
  hasPassword: boolean;
  hasTotp: boolean;
  /** The user may edit everything (otherwise only favorite and folder). */
  edit: boolean;
  /** The login holds a passkey. */
  hasPasskey: boolean;
  /** Set when the item is in the trash. */
  deletedDate?: string;
  revisionDate: string;
}

export interface PasskeyChoice {
  cipherId: string;
  name: string;
  userName?: string;
  /** When the login holding the passkey was saved, to tell duplicates apart. */
  savedAt: string;
  /** Short credential id fragment, shown only when two choices would otherwise look identical. */
  shortId: string;
}

export interface WebAuthnPrompt {
  kind: "get" | "create";
  host: string;
  /** Human-friendly site name: the RP's name when creating, else the registrable domain. */
  siteName: string;
  rpId: string;
  rpName?: string;
  userName?: string;
  fallbackSupported: boolean;
  /** get: logins holding a usable passkey. create: logins for this site that can receive one. */
  choices: PasskeyChoice[];
}

export type WebAuthnChoice =
  { cipherId: string } | { newLogin: true } | { fallback: true } | { cancel: true };

export interface Folder {
  id: string;
  name: string;
}

export const FillMode = Object.freeze({
  /** Only frames whose URL matches one of the item's websites (keyboard shortcut, inline menu). */
  Strict: "strict",
  /** The user picked this item explicitly: also fill same-origin frames of a non-matching page. */
  Explicit: "explicit",
} as const);
export type FillMode = (typeof FillMode)[keyof typeof FillMode];

export type FillResult =
  | {
      kind: "filled";
      totpCopied: boolean;
      /** Set when the page isn't one of the item's websites: offer to save it for next time. */
      unmatched?: { origin: string; host: string; canSave: boolean };
    }
  | { kind: "nothingToFill" };

export const VaultTimeout = Object.freeze({
  /** Only when the browser restarts (session storage is cleared then). */
  OnRestart: 0,
  /** When the computer locks or the screensaver starts. */
  OnSystemLock: -1,
} as const);

/** Why the vault is locked, shown on the lock screen. Absent after a browser or extension restart. */
export const LockReason = Object.freeze({
  Timeout: "timeout",
  SystemLock: "systemLock",
  Manual: "manual",
  RestoreFailed: "restoreFailed",
} as const);
export type LockReason = (typeof LockReason)[keyof typeof LockReason];

export interface Status {
  /** Build of the running service worker; the popup refuses to talk to a different one. */
  buildId: string;
  status: AuthStatus;
  email?: string;
  pinEnabled: boolean;
  lastSync?: number;
  lockReason?: LockReason;
}

export const CopyableField = Object.freeze({
  Username: "username",
  Password: "password",
  Totp: "totp",
} as const);
export type CopyableField = (typeof CopyableField)[keyof typeof CopyableField];

export type GeneratorRequest =
  | { kind: "password"; options: PasswordGeneratorRequest }
  | { kind: "passphrase"; options: PassphraseGeneratorRequest };

export interface Settings {
  /**
   * Minutes of inactivity before locking, or one of the `VaultTimeout` sentinels. As in the
   * reference client, "on system lock" is a timeout choice of its own, so it can't silently
   * override "on browser restart".
   */
  vaultTimeoutMinutes: number | null;
  clearClipboardSeconds: number | null;
  /** Copy the item's one-time code after autofill, for the site's 2FA step. */
  copyTotpOnFill: boolean;
  /** Load favicons from the server's icon service (reveals which sites are in the vault to it). */
  showIcons: boolean;
  /** Suggest matching logins in a dropdown on sign-in fields (needs a script on every page). */
  inlineMenu: boolean;
  /** Offer and save passkeys (wraps navigator.credentials on https pages). */
  passkeys: boolean;
}

/**
 * Every call the popup can make into the service worker. Keep payloads small: the popup
 * receives list views (no secrets) and fetches individual secrets only on demand.
 */
export interface Rpc {
  status(): Status;
  getEnvironment(): Environment;
  setEnvironment(env: Environment): void;

  login(email: string, password: string): LoginResult;
  loginTwoFactor(provider: TwoFactorProvider, token: string, remember: boolean): LoginResult;
  sendTwoFactorEmail(): void;
  loginNewDevice(otp: string): LoginResult;

  unlockWithPassword(password: string): boolean;
  /** Re-verifies the master password for items marked "master password reprompt". */
  verifyMasterPassword(password: string): boolean;
  unlockWithPin(pin: string): boolean;
  setPin(pin: string | null): void;
  lock(): void;
  logout(): void;

  sync(): void;
  listCiphers(): VaultItem[];
  listTrash(): VaultItem[];
  getCipher(id: string): CipherView;
  /** Creates (no id) or updates the item; returns its id. */
  saveCipher(view: CipherView): string;
  setFavorite(id: string, favorite: boolean): void;
  trashCipher(id: string): void;
  restoreCipher(id: string): void;
  deleteCipherForever(id: string): void;
  /** Saves a website to a login so it matches next time. */
  addSiteToItem(id: string, origin: string): void;
  listFolders(): Folder[];
  createFolder(name: string): Folder;
  /** Copies a secret via the service worker so it never passes through the popup. */
  copyField(id: string, field: CopyableField): boolean;
  copyText(text: string): void;
  totp(id: string): TotpResponse | undefined;
  /** Passkey prompt window: what the site asked for and what the user can pick. */
  webauthnRequest(id: string): WebAuthnPrompt | undefined;
  webauthnRespond(id: string, choice: WebAuthnChoice): void;
  /** Previews a code for a secret or otpauth:// URI being typed in the editor. */
  previewTotp(key: string): TotpResponse | undefined;
  /** Finds an authenticator QR code on the visible tab; returns its otpauth:// URI. */
  scanTotpQr(tabId: number): string | undefined;

  ciphersForTab(tabId: number): VaultItem[];
  autofill(tabId: number, cipherId: string, mode: FillMode): FillResult;

  generate(request: GeneratorRequest): string;

  getSettings(): Settings;
  setSettings(settings: Settings): void;
}

export type RpcMethod = keyof Rpc;

export interface RpcRequest<M extends RpcMethod = RpcMethod> {
  rpc: M;
  args: Parameters<Rpc[M]>;
}

export type RpcResponse<M extends RpcMethod = RpcMethod> =
  { ok: true; value: ReturnType<Rpc[M]> } | { ok: false; error: string };

export function isRpcRequest(message: unknown): message is RpcRequest {
  return typeof message === "object" && message !== null && "rpc" in message && "args" in message;
}

/** Calls the service worker. Used from the popup and other extension pages. */
export async function call<M extends RpcMethod>(
  rpc: M,
  ...args: Parameters<Rpc[M]>
): Promise<ReturnType<Rpc[M]>> {
  const response = (await chrome.runtime.sendMessage({ rpc, args } satisfies RpcRequest<M>)) as
    RpcResponse<M> | undefined;
  if (response === undefined) {
    throw new Error("No response from background");
  }
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.value;
}
