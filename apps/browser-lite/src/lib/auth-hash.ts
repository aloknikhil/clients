import type { Kdf } from "@bitwarden/sdk-internal";

import { PureCrypto } from "./sdk";

/**
 * Builds the master password authentication hash sent to `/connect/token`.
 *
 * KEY MANAGEMENT REVIEW: mirrors `MasterPasswordService.makeMasterPasswordAuthenticationData`
 * (libs/common/src/key-management/master-password/services/master-password.service.ts).
 * The KDF runs in the SDK; only the final single PBKDF2-SHA256 round happens here because the
 * SDK's password login does not yet support two-factor or new-device verification.
 * Remove once the SDK exposes this directly.
 */
export async function masterPasswordAuthHash(
  password: string,
  salt: string,
  kdf: Kdf,
): Promise<string> {
  if (password === "") {
    throw new Error("Master password cannot be empty.");
  }
  const encoder = new TextEncoder();
  // Callers can't be trusted to normalize the salt; the server expects it lowercased and trimmed.
  const normalizedSalt = salt.toLowerCase().trim();
  const masterKey = PureCrypto.derive_kdf_material(
    encoder.encode(password),
    encoder.encode(normalizedSalt),
    kdf,
  );

  // WebCrypto requires an ArrayBuffer-backed view; the wasm returns one over its own memory.
  const keyBytes = new Uint8Array(masterKey);
  masterKey.fill(0);
  const keyMaterial = await crypto.subtle.importKey("raw", keyBytes, "PBKDF2", false, [
    "deriveBits",
  ]);
  keyBytes.fill(0);
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(password), iterations: 1 },
    keyMaterial,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}
