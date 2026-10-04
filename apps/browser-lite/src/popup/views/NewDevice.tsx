import { useState } from "preact/hooks";

import { t } from "../../lib/i18n";
import { call, type LoginResult } from "../../lib/rpc";
import { ErrorText, Icon, Topbar, useAction } from "../components";

export function NewDevice({
  onResult,
  onCancel,
}: {
  onResult: (result: LoginResult) => void;
  onCancel: () => void;
}) {
  const [otp, setOtp] = useState("");
  const { run, busy, error, setError } = useAction(async () => {
    const result = await call("loginNewDevice", otp);
    if (result.kind === "error") {
      setError(result.message);
      return;
    }
    onResult(result);
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
          <span class="label">{t("newDevice")}</span>
          <h1 class="title">{t("verifyYourIdentity")}</h1>
          <p class="muted" style={{ margin: 0 }}>
            {t("newDeviceVerificationDesc")}
          </p>
        </div>
        <div class="stack">
          <div class="input-group">
            <input
              class="input mono"
              required
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              aria-label={t("verificationCode")}
              value={otp}
              onInput={(e) => setOtp(e.currentTarget.value)}
            />
            <button class="submit" type="submit" aria-label={t("continue")} disabled={busy}>
              <Icon name="arrow" size={14} />
            </button>
          </div>
          <ErrorText error={error} />
        </div>
      </form>
    </div>
  );
}
