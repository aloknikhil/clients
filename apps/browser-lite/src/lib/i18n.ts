/** Looks up a localized string from `_locales/<lang>/messages.json`. */
export function t(key: string, ...substitutions: string[]): string {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/**
 * For screens shown while the extension is mid-update: Chrome keeps serving the old
 * `messages.json` until reload, so newly added keys may not resolve yet.
 */
export function tOr(key: string, fallback: string): string {
  return chrome.i18n.getMessage(key) || fallback;
}
