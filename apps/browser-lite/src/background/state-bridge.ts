import type { WasmStateBridge } from "@bitwarden/sdk-internal";

/**
 * Key-management state the SDK reads and writes during unlock and sync. Mirrors
 * `JsWasmStateBridge` (libs/common/src/key-management/state-bridge.ts), including where each
 * value lives: decrypted key material goes to memory-only session storage, wrapped (encrypted)
 * material and settings go to local storage.
 */
const MEMORY_FIELDS = new Set(["user_key", "ephemeral_pin_envelope"]);

const FIELDS = [
  "user_key",
  "user_key_id",
  "persistent_pin_envelope",
  "ephemeral_pin_envelope",
  "encrypted_pin",
  "v2_upgrade_token",
  "account_cryptographic_state",
  "masterpassword_unlock_data",
  "webauthn_prf_unlock_data",
  "kdf_config",
  "v2_encrypted_migrations_grace_period_start",
] as const;

type Field = (typeof FIELDS)[number];

function area(field: Field): chrome.storage.StorageArea {
  return MEMORY_FIELDS.has(field) ? chrome.storage.session : chrome.storage.local;
}

export function createStateBridge(userId: string): WasmStateBridge {
  const key = (field: Field) => `km:${userId}:${field}`;
  const bridge: Record<string, (value?: unknown) => Promise<unknown>> = {};
  for (const field of FIELDS) {
    bridge[`get_${field}`] = async () => (await area(field).get(key(field)))[key(field)] ?? null;
    bridge[`set_${field}`] = (value) => area(field).set({ [key(field)]: value });
    bridge[`clear_${field}`] = () => area(field).remove(key(field));
  }
  return bridge as unknown as WasmStateBridge;
}

/** Removes all bridge state for a user (logout). */
export async function clearStateBridge(userId: string): Promise<void> {
  const keys = FIELDS.map((field) => `km:${userId}:${field}`);
  await Promise.all([chrome.storage.local.remove(keys), chrome.storage.session.remove(keys)]);
}
