# Bitwarden Lite (browser extension)

A from-scratch, minimal Manifest V3 Chrome extension for Bitwarden. It targets near feature parity
with `apps/browser` while staying small and fast. It is built with Preact and Vite, and all
cryptography runs in `@bitwarden/sdk-internal`.

```sh
npm run build -w @bitwarden/browser-lite      # -> dist/apps/browser-lite (load unpacked)
npx jest -c apps/browser-lite/jest.config.js
```

## Architecture

| Context        | Entry                     | Responsibility                                                                   |
| -------------- | ------------------------- | -------------------------------------------------------------------------------- |
| Service worker | `src/background/index.ts` | Owns the SDK client and all key material. Serves a typed RPC (`src/lib/rpc.ts`). |
| Popup          | `src/popup/main.tsx`      | UI only. Never loads the SDK or wasm. Receives list views (no secrets).          |
| Content script | `src/content/autofill.ts` | Injected **on demand only**. Finds fields and fills the values it is handed.     |
| Offscreen doc  | `src/offscreen/`          | Clipboard writes and timed clipboard clearing (service workers have no DOM).     |

- **Crypto.** KDF, key unwrapping, encryption and decryption all go through the SDK. The only
  crypto-adjacent code in this app is `src/lib/auth-hash.ts`, the final 1-iteration PBKDF2 of the
  server auth hash. It mirrors `MasterPasswordService` and is verified byte-for-byte against the
  reference algorithm. It needs **@bitwarden/team-key-management-dev review**, and should be removed
  once the SDK's password login supports 2FA and new-device verification.
- **Storage.**
  - `chrome.storage.local` holds only encrypted data: SDK domain objects, wrapped keys and tokens.
  - The unlocked user key lives in `chrome.storage.session`, which is memory-only, cleared on lock,
    and not readable by content scripts. This lets the vault survive service-worker suspension.
- **Secrets on demand.**
  - The SDK's `CipherListView` contains no passwords, but it **does** carry notes, custom fields
    and the TOTP seed. So the popup never receives it. The service worker projects each item
    onto `VaultItem` (`background/items.ts`) from an explicit allowlist, and a test enforces that
    notes, fields and TOTP seeds stay out.
  - Passwords are decrypted per item, and only for view, copy or fill. Copy happens in the service
    worker, so the secret never passes through the popup.
- **SDK state bridge.**
  - `background/state-bridge.ts` implements `WasmStateBridge`, the key-management state the SDK
    reads and writes during unlock and sync. Without it, sync hangs or panics.
  - Placement mirrors `JsWasmStateBridge`: the user key and the ephemeral PIN envelope go to
    memory-only session storage, and wrapped material goes to local storage.
- **Autofill safety.**
  - Each frame receives values only if its _own_ URL matches the item's URIs, so cross-origin
    iframes get nothing.
  - An `https` login is never filled into an `http` frame.
  - `data-bwignore` is honored.
  - Master-password-reprompt items are excluded from the keyboard shortcut.
- **RPC trust.** The service worker only answers messages whose sender URL is this extension's
  origin.

## Design

- **Design language:** [Oxide](https://oxide.computer), with tokens taken from the MPL-2.0
  `@oxide/design-system`.
  - Blue-tinted near-black surfaces with 1px hairline strokes.
  - Hierarchy by tone, not weight.
  - 11-12px uppercase mono for all interface labels, buttons and status text.
  - Green rationed to the primary action, focus and selection. The primary button is green text
    on dark green.
  - 2-4px radii.
  - Checkboxes, not switches.
- **Fonts:** Inter Tight and Geist Mono, both SIL OFL. They stand in for the commercial Suisse
  Int'l and GT America Mono, and are bundled locally rather than fetched from a CDN.
- **Icons:** Lucide, with stroke width scaled to land on 1.5 device pixels.
- **Item tiles:** favicons served by the user's own server (`/icons/<host>/icon.png`), which can
  be turned off in Settings. When there's no favicon, a monogram in one of Oxide's semantic tag
  colors is shown instead.
- **Themes:** dark is the default; light uses Oxide's light tokens.

## Features beyond milestone 1

- **Editing:** create and edit logins, cards, identities and notes, including websites with match
  detection, custom fields (text, hidden, checkbox), folders (with inline creation), favorite and
  master-password reprompt.
  - Edits go through the SDK, which keeps password history.
  - Items the user can't fully edit only accept folder and favorite changes.
  - Hidden-password organization items keep their real password server side.
- **Trash:** move to trash, restore, delete forever.
- **Fill on any page:** an explicit Fill always works, and also fills same-origin frames. Cross-origin
  iframes never receive values. When the page isn't one of the item's sites, the popup offers to
  save it. The keyboard shortcut and inline menu remain strict-match only.
- **TOTP:**
  - Set the key in the editor as a secret or `otpauth://` link, with a live preview.
  - Scan an authenticator QR code from the visible tab with jsQR, using `activeTab`. Only the
    `otpauth://` link is kept, never the screenshot.
  - The code is copied after autofill (configurable).
  - The code is filled into one-time-code fields.
- **Inline menu:** a dropdown on sign-in fields, toggled in Settings.
  - The content script is registered dynamically with `chrome.scripting.registerContentScripts`
    and only receives a lock state and a match count.
  - The menu is an extension-origin iframe in a closed shadow root, so the page can't read it or
    restyle it.
  - The iframe has its own narrow message channel. Requests are scoped to `sender.tab`, as set by
    Chrome, and it can fill only items that match that tab. It's barred from the popup's API.

## Size (production build)

| Piece                                 | Raw     | Gzip    |
| ------------------------------------- | ------- | ------- |
| Popup JS + CSS (loaded on every open) | ~58 kB  | ~19 kB  |
| Service worker JS                     | ~278 kB | ~77 kB  |
| Content script (only when filling)    | ~2 kB   | ~1 kB   |
| SDK wasm (service worker only)        | 7.85 MB | 3.08 MB |

The reference extension declares 16 permissions and injects 2 content scripts into every frame of
every page. This one declares 9 and injects nothing until you autofill.

## Status

**Milestone 1 (done):**

- Log in with a master password, with 2FA (authenticator, email, YubiKey OTP, "remember me") and
  new-device verification.
- Cloud US, cloud EU and self-hosted servers.
- Unlock with master password or PIN. Vault timeout, lock on system lock, logout.
- Full sync of ciphers, folders and Sends, plus org keys.
- Vault list with search, page suggestions, and copy for username, password and TOTP.
- Item view for every cipher type, with a live TOTP countdown.
- Master-password reprompt.
- On-demand autofill from the popup or `Ctrl+Shift+L`.
- Password and passphrase generator (`Ctrl+Shift+9` copies one).
- Clipboard auto-clear.

**Milestone 2:** context menus, equivalent domains, card/identity autofill, item create/edit/delete,
folders, favorites, trash, password history, attachments, and the save/update-password prompt. The
prompt's content script will be registered dynamically, only when enabled.

**Milestone 3:** Send, import/export (SDK exporter), SSO, Duo and WebAuthn 2FA (via the web vault
connector), login with device, and trusted-device encryption.

**Milestone 4:** inline autofill menu, passkeys, biometric unlock via the desktop app, push-triggered
sync, account switching, Firefox/Safari builds.

## Not yet supported

- Accounts without a master password (SSO-only, TDE, Key Connector) can't log in.
- Duo and WebAuthn 2FA aren't available. Users need an authenticator-app or email method.
- Never-lock timeout.
- Provider-managed org keys.
- Item-type Sends round-trip only as raw data.
