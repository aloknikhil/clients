import { useEffect, useState } from "preact/hooks";

import type { Environment } from "../../lib/env";
import { t } from "../../lib/i18n";
import { call, type Settings as SettingsModel, type Status, VaultTimeout } from "../../lib/rpc";
import { urlsFor } from "../../lib/env";
import { ErrorText, Icon, Spinner, Switch, Topbar, useAction, useToast } from "../components";

const TIMEOUTS: { value: string; label: string }[] = [
  { value: "1", label: "oneMinute" },
  { value: "5", label: "fiveMinutes" },
  { value: "15", label: "fifteenMinutes" },
  { value: "30", label: "thirtyMinutes" },
  { value: "60", label: "oneHour" },
  { value: "240", label: "fourHours" },
  { value: String(VaultTimeout.OnSystemLock), label: "onSystemLock" },
  { value: String(VaultTimeout.OnRestart), label: "onRestart" },
];

const CLIPBOARD: { value: string; label: string }[] = [
  { value: "null", label: "never" },
  { value: "30", label: "thirtySeconds" },
  { value: "60", label: "oneMinute" },
  { value: "120", label: "twoMinutes" },
  { value: "300", label: "fiveMinutes" },
];

function Option({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="option">
      <span class="muted">{label}</span>
      {children}
    </div>
  );
}

export function Settings({
  status,
  onBack,
  onTrash,
  onLocked,
  onLoggedOut,
}: {
  status: Status;
  onBack: () => void;
  onTrash: () => void;
  onLocked: () => void;
  onLoggedOut: () => void;
}) {
  const [settings, setSettings] = useState<SettingsModel>();
  const [env, setEnv] = useState<Environment>();
  const [pinEnabled, setPinEnabled] = useState(status.pinEnabled);
  const [settingPin, setSettingPin] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [lastSync, setLastSync] = useState(status.lastSync);
  const toast = useToast();

  useEffect(() => {
    void call("getSettings").then(setSettings);
    void call("getEnvironment").then(setEnv);
  }, []);

  async function update(patch: Partial<SettingsModel>) {
    const next = { ...settings!, ...patch };
    setSettings(next);
    await call("setSettings", next);
  }

  const sync = useAction(async () => {
    await call("sync");
    setLastSync(Date.now());
    toast(t("syncingComplete"));
  });
  const pin = useAction(async (value: string | null) => {
    await call("setPin", value);
    setPinEnabled(value !== null);
    setSettingPin(false);
    setNewPin("");
  });
  const lock = useAction(async () => {
    await call("lock");
    onLocked();
  });
  const logout = useAction(async () => {
    await call("logout");
    onLoggedOut();
  });

  if (!settings) {
    return null;
  }
  return (
    <div class="view">
      <Topbar title={t("settings")} onBack={onBack} />
      <div class="scroll" style={{ padding: "12px 0" }}>
        <div class="group-title label">{t("security")}</div>
        <div class="group">
          <Option label={t("vaultTimeout")}>
            <select
              class="input"
              aria-label={t("vaultTimeout")}
              value={String(settings.vaultTimeoutMinutes)}
              onChange={(e) => void update({ vaultTimeoutMinutes: Number(e.currentTarget.value) })}
            >
              {TIMEOUTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.label)}
                </option>
              ))}
            </select>
          </Option>
          <Option label={t("unlockWithPin")}>
            <Switch
              checked={pinEnabled || settingPin}
              label={t("unlockWithPin")}
              onChange={(v) => (v ? setSettingPin(true) : void pin.run(null))}
            />
          </Option>
          {settingPin && (
            <form
              class="option"
              onSubmit={(e) => {
                e.preventDefault();
                void pin.run(newPin);
              }}
            >
              <div class="input-group" style={{ flex: 1 }}>
                <input
                  class="input mono"
                  type="password"
                  inputMode="numeric"
                  minLength={4}
                  required
                  autoFocus
                  autoComplete="off"
                  placeholder={t("newPin")}
                  aria-label={t("newPin")}
                  style={{ height: "32px" }}
                  value={newPin}
                  onInput={(e) => setNewPin(e.currentTarget.value)}
                />
                <button
                  class="submit"
                  type="submit"
                  aria-label={t("save")}
                  disabled={pin.busy}
                  style={{ top: "2px" }}
                >
                  <Icon name="check" size={14} />
                </button>
              </div>
            </form>
          )}
          <Option label={t("clearClipboard")}>
            <select
              class="input"
              aria-label={t("clearClipboard")}
              value={String(settings.clearClipboardSeconds)}
              onChange={(e) =>
                void update({
                  clearClipboardSeconds:
                    e.currentTarget.value === "null" ? null : Number(e.currentTarget.value),
                })
              }
            >
              {CLIPBOARD.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.label)}
                </option>
              ))}
            </select>
          </Option>
        </div>

        <div class="group-title label">{t("autofill")}</div>
        <div class="group">
          <Option label={t("inlineMenu")}>
            <Switch
              checked={settings.inlineMenu}
              label={t("inlineMenu")}
              onChange={(v) => void update({ inlineMenu: v })}
            />
          </Option>
          <Option label={t("usePasskeys")}>
            <Switch
              checked={settings.passkeys}
              label={t("usePasskeys")}
              onChange={(v) => void update({ passkeys: v })}
            />
          </Option>
          <Option label={t("copyTotpOnFill")}>
            <Switch
              checked={settings.copyTotpOnFill}
              label={t("copyTotpOnFill")}
              onChange={(v) => void update({ copyTotpOnFill: v })}
            />
          </Option>
          <Option label={t("showWebsiteIcons")}>
            <Switch
              checked={settings.showIcons}
              label={t("showWebsiteIcons")}
              onChange={(v) => void update({ showIcons: v })}
            />
          </Option>
        </div>

        <div class="group-title label">{t("vault")}</div>
        <div class="group">
          <button type="button" class="option option-link" onClick={onTrash}>
            <span class="muted">{t("trash")}</span>
            <Icon name="arrow" size={15} />
          </button>
        </div>

        <div class="group-title label">{t("account")}</div>
        <div class="group">
          <Option label={t("email")}>
            <span class="mono faint" style={{ fontSize: "12px" }}>
              {status.email}
            </span>
          </Option>
          <Option label={t("server")}>
            <span class="mono faint" style={{ fontSize: "12px" }}>
              {env ? new URL(urlsFor(env).webVault).host : ""}
            </span>
          </Option>
          <Option
            label={
              lastSync ? t("lastSync", new Date(lastSync).toLocaleTimeString()) : t("syncVaultNow")
            }
          >
            <button
              type="button"
              class="btn"
              style={{ height: "28px" }}
              disabled={sync.busy}
              onClick={() => void sync.run()}
            >
              {sync.busy ? <Spinner /> : <Icon name="refresh" size={13} />}
              {t("sync")}
            </button>
          </Option>
        </div>

        <div class="pad stack" style={{ paddingTop: "4px" }}>
          <ErrorText error={pin.error ?? sync.error ?? lock.error ?? logout.error} />
          <button type="button" class="btn block" onClick={() => void lock.run()}>
            <Icon name="lock" size={14} />
            {t("lockNow")}
          </button>
          <button type="button" class="btn ghost danger block" onClick={() => void logout.run()}>
            <Icon name="logout" size={14} />
            {t("logOut")}
          </button>
        </div>
        <div class="meta" style={{ textAlign: "center" }}>
          v{chrome.runtime.getManifest().version}
        </div>
      </div>
    </div>
  );
}
