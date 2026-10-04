import { useState } from "preact/hooks";

import { t } from "../../lib/i18n";
import { call, TwoFactorProvider, type LoginResult } from "../../lib/rpc";
import { ErrorText, Icon, Segmented, Switch, Topbar, useAction, useToast } from "../components";

/** Providers that only need a typed code. Duo and WebAuthn need the web vault connector. */
const CODE_PROVIDERS: TwoFactorProvider[] = [
  TwoFactorProvider.Authenticator,
  TwoFactorProvider.Yubikey,
  TwoFactorProvider.Email,
];

const PROVIDER_KEY: Record<TwoFactorProvider, string> = {
  [TwoFactorProvider.Authenticator]: "twoFactorAuthenticator",
  [TwoFactorProvider.Email]: "twoFactorEmail",
  [TwoFactorProvider.Duo]: "twoFactorDuo",
  [TwoFactorProvider.Yubikey]: "twoFactorYubikey",
  [TwoFactorProvider.OrganizationDuo]: "twoFactorDuo",
  [TwoFactorProvider.WebAuthn]: "twoFactorWebAuthn",
};

export function TwoFactor({
  providers,
  onResult,
  onCancel,
}: {
  providers: TwoFactorProvider[];
  onResult: (result: LoginResult) => void;
  onCancel: () => void;
}) {
  const usable = CODE_PROVIDERS.filter((p) => providers.includes(p));
  const [provider, setProvider] = useState<TwoFactorProvider | undefined>(usable[0]);
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const toast = useToast();

  const submit = useAction(async () => {
    const result = await call("loginTwoFactor", provider!, code, remember);
    if (result.kind === "error") {
      submit.setError(result.message);
      setCode("");
      return;
    }
    onResult(result);
  });
  const sendEmail = useAction(async () => {
    await call("sendTwoFactorEmail");
    toast(t("verificationCodeSent"));
  });

  return (
    <div class="view">
      <Topbar onBack={onCancel} />
      <form
        class="auth"
        style={{ justifyContent: "flex-start", paddingTop: "8px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit.run();
        }}
      >
        <div class="auth-head">
          <span class="label">{t("twoStepLogin")}</span>
          <h1 class="title">{t("verifyItsYou")}</h1>
        </div>
        {provider === undefined ? (
          <p class="muted">{t("twoFactorUnsupported")}</p>
        ) : (
          <div class="stack">
            {usable.length > 1 && (
              <Segmented
                value={String(provider)}
                options={usable.map((p) => ({ value: String(p), label: t(PROVIDER_KEY[p]) }))}
                onChange={(v) => {
                  setProvider(Number(v) as TwoFactorProvider);
                  setCode("");
                }}
              />
            )}
            <p class="muted" style={{ margin: 0 }}>
              {t(`${PROVIDER_KEY[provider]}Desc`)}
            </p>
            <div class="input-group">
              <input
                class="input mono"
                required
                autoFocus
                autoComplete="one-time-code"
                inputMode={provider === TwoFactorProvider.Yubikey ? "text" : "numeric"}
                aria-label={t("verificationCode")}
                placeholder={provider === TwoFactorProvider.Yubikey ? "" : "000000"}
                value={code}
                onInput={(e) => setCode(e.currentTarget.value)}
              />
              <button
                class="submit"
                type="submit"
                aria-label={t("continue")}
                disabled={submit.busy}
              >
                <Icon name="arrow" size={14} />
              </button>
            </div>
            <div class="row" style={{ justifyContent: "space-between" }}>
              <span class="muted">{t("rememberDevice")}</span>
              <Switch checked={remember} label={t("rememberDevice")} onChange={setRemember} />
            </div>
            <ErrorText error={submit.error ?? sendEmail.error} />
            {provider === TwoFactorProvider.Email && (
              <button
                type="button"
                class="link"
                disabled={sendEmail.busy}
                onClick={() => void sendEmail.run()}
              >
                {t("sendVerificationCodeEmail")}
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
