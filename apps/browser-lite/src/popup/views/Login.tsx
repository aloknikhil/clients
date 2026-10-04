import { useEffect, useState } from "preact/hooks";

import { Region, type Environment } from "../../lib/env";
import { t } from "../../lib/i18n";
import { call, type LoginResult } from "../../lib/rpc";
import { ErrorText, Icon, Mark, Segmented, Spinner, useAction } from "../components";

function hostLabel(env: Environment): string {
  if (env.region === Region.US) {
    return "bitwarden.com";
  }
  if (env.region === Region.EU) {
    return "bitwarden.eu";
  }
  try {
    return new URL(env.baseUrl ?? "").host || t("selfHosted");
  } catch {
    return t("selfHosted");
  }
}

export function Login({ onResult }: { onResult: (result: LoginResult) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [env, setEnv] = useState<Environment>({ region: Region.US });
  const [serverOpen, setServerOpen] = useState(false);

  useEffect(() => {
    void call("getEnvironment").then(setEnv);
  }, []);

  const { run, busy, error, setError } = useAction(async () => {
    await call("setEnvironment", env);
    const result = await call("login", email, password);
    if (result.kind === "error") {
      setError(result.message === "ssoRequired" ? t("ssoNotSupported") : result.message);
      return;
    }
    setPassword("");
    onResult(result);
  });

  return (
    <div class="view">
      <form
        class="auth"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div class="auth-head">
          <Mark size={36} />
          <h1 class="title">{t("signIn")}</h1>
          <p class="muted" style={{ margin: 0 }}>
            {t("signInDesc")}
          </p>
        </div>
        <div class="stack">
          <label class="field-label">
            <span class="label">{t("emailAddress")}</span>
            <input
              class="input"
              type="email"
              required
              autoFocus
              autoComplete="username"
              spellcheck={false}
              value={email}
              onInput={(e) => setEmail(e.currentTarget.value)}
            />
          </label>
          <label class="field-label">
            <span class="label">{t("masterPassword")}</span>
            <input
              class="input mono"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </label>
          {serverOpen && (
            <div class="stack">
              <Segmented
                value={env.region}
                options={[
                  { value: Region.US, label: "US" },
                  { value: Region.EU, label: "EU" },
                  { value: Region.SelfHosted, label: t("selfHosted") },
                ]}
                onChange={(region) => setEnv({ ...env, region })}
              />
              {env.region === Region.SelfHosted && (
                <input
                  class="input mono"
                  type="url"
                  required
                  placeholder="https://vault.example.com"
                  aria-label={t("serverUrl")}
                  spellcheck={false}
                  value={env.baseUrl ?? ""}
                  onInput={(e) => setEnv({ ...env, baseUrl: e.currentTarget.value })}
                />
              )}
            </div>
          )}
          <ErrorText error={error} />
          <button class="btn primary block" type="submit" disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? t("signingIn") : t("continue")}
          </button>
        </div>
      </form>
      <footer class="auth-foot">
        <button
          type="button"
          class="server-chip"
          aria-expanded={serverOpen}
          title={t("server")}
          onClick={() => setServerOpen(!serverOpen)}
        >
          <span class="dot" />
          {hostLabel(env)}
        </button>
        <span class="faint mono" style={{ fontSize: "11.5px" }}>
          <Icon name="lock" size={11} /> {t("endToEnd")}
        </span>
      </footer>
    </div>
  );
}
