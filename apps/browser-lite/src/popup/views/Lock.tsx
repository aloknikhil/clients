import { useState } from "preact/hooks";

import { t } from "../../lib/i18n";
import { call, type Status } from "../../lib/rpc";
import { ErrorText, Icon, Mark, Spinner, useAction } from "../components";

export function Lock({
  status,
  onUnlocked,
  onLoggedOut,
}: {
  status: Status;
  onUnlocked: () => void;
  onLoggedOut: () => void;
}) {
  const [usePin, setUsePin] = useState(status.pinEnabled);
  const [secret, setSecret] = useState("");

  const unlock = useAction(async () => {
    const ok = usePin
      ? await call("unlockWithPin", secret)
      : await call("unlockWithPassword", secret);
    if (!ok) {
      unlock.setError(usePin ? t("invalidPin") : t("invalidMasterPassword"));
      setSecret("");
      return;
    }
    setSecret("");
    onUnlocked();
  });
  const logout = useAction(async () => {
    await call("logout");
    onLoggedOut();
  });

  return (
    <div class="view">
      <form
        class="auth"
        onSubmit={(e) => {
          e.preventDefault();
          void unlock.run();
        }}
      >
        <div class="auth-head">
          <Mark size={36} />
          <h1 class="title">{t("locked")}</h1>
          <p class="faint mono" style={{ margin: 0, fontSize: "12px" }}>
            {status.email}
          </p>
        </div>
        <div class="stack">
          <div class="input-group">
            <input
              class="input mono"
              type="password"
              required
              autoFocus
              inputMode={usePin ? "numeric" : undefined}
              autoComplete="current-password"
              aria-label={usePin ? t("pin") : t("masterPassword")}
              placeholder={usePin ? t("pin") : t("masterPassword")}
              value={secret}
              onInput={(e) => setSecret(e.currentTarget.value)}
            />
            <button class="submit" type="submit" aria-label={t("unlock")} disabled={unlock.busy}>
              {unlock.busy ? <Spinner /> : <Icon name="arrow" size={14} />}
            </button>
          </div>
          <ErrorText error={unlock.error ?? logout.error} />
        </div>
      </form>
      <footer class="auth-foot">
        {status.pinEnabled ? (
          <button
            type="button"
            class="link"
            onClick={() => {
              setUsePin(!usePin);
              setSecret("");
              unlock.setError(undefined);
            }}
          >
            {usePin ? t("useMasterPassword") : t("usePin")}
          </button>
        ) : (
          <span />
        )}
        <button type="button" class="link" onClick={() => void logout.run()}>
          {t("logOut")}
        </button>
      </footer>
    </div>
  );
}
