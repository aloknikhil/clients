// Kept separate from uri-match so the popup doesn't pull in the public suffix list.

/** Saved URIs are often scheme-less ("example.com"); treat those as http(s) URLs. */
export function toUrl(uri: string): URL | undefined {
  const trimmed = uri.trim();
  if (trimmed === "" || /^(data|about|javascript):/i.test(trimmed)) {
    return undefined;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    return undefined;
  }
}
