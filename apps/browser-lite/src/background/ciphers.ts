import type { CipherView } from "@bitwarden/sdk-internal";

import { repositories, vault } from "./vault";

export async function decryptCipher(id: string): Promise<CipherView> {
  const cipher = await repositories.ciphers.get(id);
  if (cipher === null) {
    throw new Error("Item not found");
  }
  return vault.sdk().vault().ciphers().decrypt(cipher);
}

export function totpCode(cipher: CipherView): string | undefined {
  const key = cipher.login?.totp;
  return key ? vault.sdk().vault().totp().generate_totp(key).code : undefined;
}
