import { useState } from "preact/hooks";

import { t } from "../../lib/i18n";
import { call } from "../../lib/rpc";
import { ErrorText, Icon, Topbar, useAction } from "../components";

/** Master password re-entry for items marked "master password reprompt". */
export function Reprompt({
  onVerified,
  onCancel,
}: {
  onVerified: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const { run, busy, error, setError } = useAction(async () => {
    if (await call("verifyMasterPassword", password)) {
      onVerified();
    } else {
      setError(t("invalidMasterPassword"));
      setPassword("");
    }
  });
  return (
    <div class="view">
      <Topbar onBack={onCancel} />
      <form
        class="auth"
        style={{ justifyContent: "flex-start", paddingTop: "8px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div class="auth-head">
          <span class="label">{t("protectedItem")}</span>
          <h1 class="title">{t("passwordConfirmation")}</h1>
          <p class="muted" style={{ margin: 0 }}>
            {t("passwordConfirmationDesc")}
          </p>
        </div>
        <div class="stack">
          <div class="input-group">
            <input
              class="input mono"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              aria-label={t("masterPassword")}
              placeholder={t("masterPassword")}
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
            <button class="submit" type="submit" aria-label={t("confirm")} disabled={busy}>
              <Icon name="arrow" size={14} />
            </button>
          </div>
          <ErrorText error={error} />
        </div>
      </form>
    </div>
  );
}
