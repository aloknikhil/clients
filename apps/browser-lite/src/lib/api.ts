import { CLIENT_NAME, CLIENT_VERSION, DEVICE_TYPE, deviceIdentifier } from "./device";
import { getEnvironment, urlsFor, type ServerUrls } from "./env";
import { prop } from "./props";

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(
      prop<string>(body, "message") ?? prop<string>(body, "error_description") ?? `HTTP ${status}`,
    );
  }
}

const TOKENS_KEY = "tokens";
/** Refresh slightly before expiry so long requests don't race the deadline. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export async function serverUrls(): Promise<ServerUrls> {
  return urlsFor(await getEnvironment());
}

export async function getTokens(): Promise<Tokens | undefined> {
  return (await chrome.storage.local.get(TOKENS_KEY))[TOKENS_KEY] as Tokens | undefined;
}

export async function setTokens(tokens: Tokens | undefined): Promise<void> {
  if (tokens === undefined) {
    await chrome.storage.local.remove(TOKENS_KEY);
  } else {
    await chrome.storage.local.set({ [TOKENS_KEY]: tokens });
  }
}

export function tokensFromResponse(body: unknown, previousRefresh?: string): Tokens {
  const expiresIn = prop<number>(body, "expires_in") ?? 3600;
  return {
    accessToken: prop<string>(body, "access_token")!,
    refreshToken: prop<string>(body, "refresh_token") ?? previousRefresh,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

function platformHeaders(): Record<string, string> {
  return {
    "Bitwarden-Client-Name": CLIENT_NAME,
    "Bitwarden-Client-Version": CLIENT_VERSION,
    "Device-Type": String(DEVICE_TYPE),
    Accept: "application/json",
  };
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Posts to `{identity}/connect/token`. Returns the raw status and body instead of throwing
 * because a 400 carries the two-factor and new-device-verification challenges.
 */
export async function identityToken(
  form: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const { identity } = await serverUrls();
  const response = await fetch(`${identity}/connect/token`, {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      ...platformHeaders(),
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: new URLSearchParams(form),
  });
  return { status: response.status, body: await parseBody(response) };
}

let refreshing: Promise<string | undefined> | undefined;

/** Returns a valid access token, refreshing it first when it is close to expiry. */
export async function accessToken(): Promise<string | undefined> {
  const tokens = await getTokens();
  if (tokens === undefined) {
    return undefined;
  }
  if (tokens.expiresAt - Date.now() > REFRESH_SKEW_MS || tokens.refreshToken === undefined) {
    return tokens.accessToken;
  }
  refreshing ??= refresh(tokens.refreshToken).finally(() => (refreshing = undefined));
  return refreshing;
}

async function refresh(refreshToken: string): Promise<string | undefined> {
  const { status, body } = await identityToken({
    grant_type: "refresh_token",
    client_id: CLIENT_NAME,
    refresh_token: refreshToken,
  });
  if (status !== 200) {
    throw new ApiError(status, body);
  }
  const tokens = tokensFromResponse(body, refreshToken);
  await setTokens(tokens);
  return tokens.accessToken;
}

export async function apiRequest<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: { body?: unknown; authenticated?: boolean } = {},
): Promise<T> {
  const { api } = await serverUrls();
  const headers: Record<string, string> = platformHeaders();
  if (options.authenticated ?? true) {
    const token = await accessToken();
    if (token === undefined) {
      throw new ApiError(401, { message: "Not logged in" });
    }
    headers.Authorization = `Bearer ${token}`;
  } else {
    headers["Device-Identifier"] = await deviceIdentifier();
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json; charset=utf-8";
  }

  const response = await fetch(`${api}${path}`, {
    method,
    cache: "no-store",
    credentials: "include",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await parseBody(response);
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body as T;
}
