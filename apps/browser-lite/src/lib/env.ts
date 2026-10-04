export const Region = Object.freeze({
  US: "us",
  EU: "eu",
  SelfHosted: "self-hosted",
} as const);
export type Region = (typeof Region)[keyof typeof Region];

export interface Environment {
  region: Region;
  /** Base URL of a self-hosted server, e.g. `https://vault.example.com`. */
  baseUrl?: string;
}

export interface ServerUrls {
  api: string;
  identity: string;
  webVault: string;
  icons: string;
  notifications: string;
}

const CLOUD: Record<Exclude<Region, "self-hosted">, ServerUrls> = {
  us: {
    api: "https://api.bitwarden.com",
    identity: "https://identity.bitwarden.com",
    webVault: "https://vault.bitwarden.com",
    icons: "https://icons.bitwarden.net",
    notifications: "https://notifications.bitwarden.com",
  },
  eu: {
    api: "https://api.bitwarden.eu",
    identity: "https://identity.bitwarden.eu",
    webVault: "https://vault.bitwarden.eu",
    icons: "https://icons.bitwarden.eu",
    notifications: "https://notifications.bitwarden.eu",
  },
};

const KEY = "environment";

export function urlsFor(env: Environment): ServerUrls {
  if (env.region !== Region.SelfHosted) {
    return CLOUD[env.region];
  }
  const base = (env.baseUrl ?? "").replace(/\/+$/, "");
  return {
    api: `${base}/api`,
    identity: `${base}/identity`,
    webVault: base,
    icons: `${base}/icons`,
    notifications: `${base}/notifications`,
  };
}

export async function getEnvironment(): Promise<Environment> {
  const stored = await chrome.storage.local.get(KEY);
  return (stored[KEY] as Environment | undefined) ?? { region: Region.US };
}

export async function setEnvironment(env: Environment): Promise<void> {
  await chrome.storage.local.set({ [KEY]: env });
}
