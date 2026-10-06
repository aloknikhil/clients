import { useEffect, useState } from "preact/hooks";

import { t } from "../../lib/i18n";
import { call, type WebAuthnChoice, type WebAuthnPrompt } from "../../lib/rpc";
import {
  ErrorText,
  Icon,
  IconButton,
  Mark,
  passkeySubtitle,
  Spinner,
  useAction,
} from "../components";

/**
 * Shown in its own window when a site asks for a passkey (button sign-in) or offers to save one.
 * Browsers don't all honor the requested window size, so this lays out as a centered card that
 * works at any window size (see `body.window-mode`).
 */
export function PasskeyPrompt({ id }: { id: string }) {
  const [prompt, setPrompt] = useState<WebAuthnPrompt | null>();

  useEffect(() => {
    document.body.classList.add("window-mode");
    call("webauthnRequest", id).then(
      (p) => setPrompt(p ?? null),
      () => setPrompt(null),
    );
  }, [id]);

  const choose = useAction(async (choice: WebAuthnChoice) => {
    await call("webauthnRespond", id, choice);
    // The service worker closes this window once the site has its answer.
  });
  const cancel = () => void choose.run({ cancel: true });

  if (prompt === undefined) {
    return (
      <div class="prompt-card">
        <div class="splash faint">
          <Spinner />
        </div>
      </div>
    );
  }

  if (prompt === null) {
    return (
      <div class="prompt-card">
        <div class="prompt-body prompt-center">
          <span class="tile lg">
            <Icon name="clock" size={20} />
          </span>
          <h1 class="title">{t("passkeyRequestExpired")}</h1>
          <p class="muted">{t("passkeyRequestExpiredDesc")}</p>
        </div>
        <footer class="prompt-foot">
          <span />
          <button type="button" class="btn" onClick={() => window.close()}>
            {t("close")}
          </button>
        </footer>
      </div>
    );
  }

  const creating = prompt.kind === "create";
  // Nothing of ours fits: the browser's own authenticators (phone, security key) are the way on.
  const noMatch = !creating && prompt.choices.length === 0;
  return (
    <div class="prompt-card">
      <header class="prompt-head">
        <Mark size={18} />
        <span class="label">{t("extName")}</span>
        <span class="spacer" />
        <IconButton icon="close" label={t("cancel")} onClick={cancel} />
      </header>

      <div class="prompt-body">
        <div class="prompt-hero">
          <span class="tile c0 lg">
            <Icon name="key" size={20} />
          </span>
          <div class="prompt-hero-text">
            <span class="label">{creating ? t("savePasskey") : t("signInWithPasskey")}</span>
            <h1 class="title" title={prompt.siteName}>
              {prompt.siteName}
            </h1>
            <span class="prompt-host mono" title={prompt.host}>
              {prompt.host}
            </span>
          </div>
        </div>

        {creating && prompt.userName && (
          <div class="prompt-account">
            <Icon name="user" size={14} />
            <span class="mono">{prompt.userName}</span>
          </div>
        )}

        <ErrorText error={choose.error} />

        {creating && (
          <button
            type="button"
            class="prompt-choice primary"
            autoFocus
            disabled={choose.busy}
            onClick={() => void choose.run({ newLogin: true })}
          >
            <span class="tile c0">
              <Icon name="plus" size={15} />
            </span>
            <span class="item-text">
              <span class="item-name">{t("saveAsNewLogin")}</span>
              <span class="item-sub">{prompt.host}</span>
            </span>
            <Icon name="arrow" size={15} />
          </button>
        )}

        {prompt.choices.length > 0 && (
          <div class="section">
            <span class="label">{creating ? t("addToExistingLogin") : t("choosePasskey")}</span>
            {!creating && <span class="label">{prompt.choices.length}</span>}
          </div>
        )}
        <div class="prompt-list">
          {prompt.choices.map((c, i) => (
            <button
              key={c.cipherId}
              type="button"
              class="prompt-choice"
              autoFocus={!creating && i === 0}
              disabled={choose.busy}
              onClick={() => void choose.run({ cipherId: c.cipherId })}
            >
              <span class={`tile c${creating ? 7 : 0}`}>
                <Icon name={creating ? "globe" : "key"} size={15} />
              </span>
              <span class="item-text">
                <span class="item-name">{c.userName || c.name}</span>
                <span class="item-sub">
                  {creating ? c.name : passkeySubtitle(c, prompt.choices)}
                </span>
              </span>
              {choose.busy ? <Spinner /> : <Icon name="arrow" size={15} />}
            </button>
          ))}
        </div>
        {noMatch && <p class="muted">{t("noPasskeysForSite")}</p>}
      </div>

      <footer class="prompt-foot">
        {prompt.fallbackSupported ? (
          <button
            type="button"
            class={noMatch ? "btn primary" : "btn ghost"}
            autoFocus={noMatch}
            onClick={() => void choose.run({ fallback: true })}
          >
            {t("useAnotherDevice")}
          </button>
        ) : (
          <span />
        )}
        <button type="button" class="btn" onClick={cancel}>
          {t("cancel")}
        </button>
      </footer>
    </div>
  );
}
