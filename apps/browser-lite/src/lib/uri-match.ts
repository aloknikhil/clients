import { parse } from "tldts";

import { toUrl } from "./url";

/** Mirrors the SDK / server `UriMatchType`. */
export const UriMatch = Object.freeze({
  Domain: 0,
  Host: 1,
  StartsWith: 2,
  Exact: 3,
  RegularExpression: 4,
  Never: 5,
} as const);
export type UriMatch = (typeof UriMatch)[keyof typeof UriMatch];

/** Hosts that share a registrable domain but must never receive its credentials. */
const DOMAIN_MATCH_BLOCKLIST = new Map<string, Set<string>>([
  ["google.com", new Set(["script.google.com"])],
]);

/** Registrable domain (eTLD+1), or the bare hostname for localhost and IPs. */
export function registrableDomain(uri: string): string | undefined {
  const url = toUrl(uri);
  if (url === undefined || url.protocol === "file:") {
    return undefined;
  }
  const result = parse(url.hostname, { allowPrivateDomains: true });
  if (result.hostname === "localhost" || result.isIp) {
    return result.hostname ?? undefined;
  }
  return result.domain ?? undefined;
}

export function uriMatches(
  savedUri: string | undefined,
  match: UriMatch | undefined,
  targetUrl: string,
  defaultMatch: UriMatch = UriMatch.Domain,
): boolean {
  if (!savedUri || !targetUrl) {
    return false;
  }
  switch (match ?? defaultMatch) {
    case UriMatch.Domain: {
      const savedDomain = registrableDomain(savedUri);
      if (savedDomain === undefined || savedDomain !== registrableDomain(targetUrl)) {
        return false;
      }
      const blocked = DOMAIN_MATCH_BLOCKLIST.get(savedDomain);
      return blocked === undefined || !blocked.has(toUrl(targetUrl)?.host ?? "");
    }
    case UriMatch.Host: {
      const host = toUrl(targetUrl)?.host;
      return host !== undefined && host === toUrl(savedUri)?.host;
    }
    case UriMatch.Exact:
      return targetUrl === savedUri;
    case UriMatch.StartsWith:
      return targetUrl.startsWith(savedUri);
    case UriMatch.RegularExpression:
      try {
        return new RegExp(savedUri, "i").test(targetUrl);
      } catch {
        return false;
      }
    default:
      return false;
  }
}
