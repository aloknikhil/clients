import type { PassphraseGeneratorRequest, PasswordGeneratorRequest } from "@bitwarden/sdk-internal";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../lib/i18n";
import { call } from "../../lib/rpc";
import { ErrorText, Icon, Secret, Segmented, Switch, Topbar, useToast } from "../components";

const OPTIONS_KEY = "generatorOptions";

interface Options {
  kind: "password" | "passphrase";
  password: PasswordGeneratorRequest;
  passphrase: PassphraseGeneratorRequest;
}

const DEFAULTS: Options = {
  kind: "password",
  password: {
    length: 20,
    lowercase: true,
    uppercase: true,
    numbers: true,
    special: true,
    avoidAmbiguous: false,
    minLowercase: undefined,
    minUppercase: undefined,
    minNumber: 1,
    minSpecial: 1,
  },
  passphrase: { numWords: 4, wordSeparator: "-", capitalize: true, includeNumber: true },
};

function Option({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="option">
      <span class="muted">{label}</span>
      {children}
    </div>
  );
}

export function Generator({ onBack }: { onBack: () => void }) {
  const [options, setOptions] = useState<Options>();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const toast = useToast();

  useEffect(() => {
    void chrome.storage.local.get(OPTIONS_KEY).then((stored) => {
      setOptions({ ...DEFAULTS, ...(stored[OPTIONS_KEY] as Partial<Options> | undefined) });
    });
  }, []);

  async function regenerate(next: Options) {
    try {
      setError(undefined);
      setValue(
        await call(
          "generate",
          next.kind === "password"
            ? { kind: "password", options: next.password }
            : { kind: "passphrase", options: next.passphrase },
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (options) {
      void regenerate(options);
      void chrome.storage.local.set({ [OPTIONS_KEY]: options });
    }
  }, [options]);

  if (!options) {
    return null;
  }
  const pw = options.password;
  const pp = options.passphrase;
  const setPw = (patch: Partial<PasswordGeneratorRequest>) =>
    setOptions({ ...options, password: { ...pw, ...patch } });
  const setPp = (patch: Partial<PassphraseGeneratorRequest>) =>
    setOptions({ ...options, passphrase: { ...pp, ...patch } });

  return (
    <div class="view">
      <Topbar title={t("generator")} onBack={onBack} />
      <div class="scroll pad stack" style={{ gap: "12px" }}>
        <div class="generated" aria-live="polite">
          <Secret value={value} />
        </div>
        <div class="generated-actions">
          <button
            type="button"
            class="btn"
            style={{ flex: 1 }}
            onClick={() => void regenerate(options)}
          >
            <Icon name="refresh" size={14} />
            {t("regenerate")}
          </button>
          <button
            type="button"
            class="btn primary"
            style={{ flex: 1 }}
            onClick={() =>
              void call("copyText", value).then(() => toast(t("valueCopied", t("password"))))
            }
          >
            <Icon name="copy" size={14} />
            {t("copy")}
          </button>
        </div>
        <ErrorText error={error} />
        <Segmented
          value={options.kind}
          options={[
            { value: "password", label: t("password") },
            { value: "passphrase", label: t("passphrase") },
          ]}
          onChange={(kind) => setOptions({ ...options, kind })}
        />
        <div class="group" style={{ margin: 0 }}>
          {options.kind === "password" ? (
            <>
              <Option label={t("length")}>
                <span class="row" style={{ width: "60%" }}>
                  <input
                    type="range"
                    min={5}
                    max={128}
                    value={pw.length}
                    style={{ "--fill": `${((pw.length - 5) / (128 - 5)) * 100}%` }}
                    aria-label={t("length")}
                    onInput={(e) => setPw({ length: Number(e.currentTarget.value) })}
                  />
                  <span class="mono" style={{ width: "28px", textAlign: "right" }}>
                    {pw.length}
                  </span>
                </span>
              </Option>
              <Option label="A–Z">
                <Switch
                  checked={pw.uppercase}
                  label="A–Z"
                  onChange={(v) => setPw({ uppercase: v })}
                />
              </Option>
              <Option label="a–z">
                <Switch
                  checked={pw.lowercase}
                  label="a–z"
                  onChange={(v) => setPw({ lowercase: v })}
                />
              </Option>
              <Option label="0–9">
                <Switch
                  checked={pw.numbers}
                  label="0–9"
                  onChange={(v) => setPw({ numbers: v, minNumber: v ? 1 : 0 })}
                />
              </Option>
              <Option label="!@#$%^&*">
                <Switch
                  checked={pw.special}
                  label={t("symbols")}
                  onChange={(v) => setPw({ special: v, minSpecial: v ? 1 : 0 })}
                />
              </Option>
              <Option label={t("avoidAmbiguous")}>
                <Switch
                  checked={pw.avoidAmbiguous}
                  label={t("avoidAmbiguous")}
                  onChange={(v) => setPw({ avoidAmbiguous: v })}
                />
              </Option>
            </>
          ) : (
            <>
              <Option label={t("numWords")}>
                <span class="row" style={{ width: "60%" }}>
                  <input
                    type="range"
                    min={3}
                    max={20}
                    value={pp.numWords}
                    style={{ "--fill": `${((pp.numWords - 3) / (20 - 3)) * 100}%` }}
                    aria-label={t("numWords")}
                    onInput={(e) => setPp({ numWords: Number(e.currentTarget.value) })}
                  />
                  <span class="mono" style={{ width: "28px", textAlign: "right" }}>
                    {pp.numWords}
                  </span>
                </span>
              </Option>
              <Option label={t("wordSeparator")}>
                <input
                  class="input mono short"
                  maxLength={1}
                  aria-label={t("wordSeparator")}
                  value={pp.wordSeparator}
                  onInput={(e) => setPp({ wordSeparator: e.currentTarget.value })}
                />
              </Option>
              <Option label={t("capitalize")}>
                <Switch
                  checked={pp.capitalize}
                  label={t("capitalize")}
                  onChange={(v) => setPp({ capitalize: v })}
                />
              </Option>
              <Option label={t("includeNumber")}>
                <Switch
                  checked={pp.includeNumber}
                  label={t("includeNumber")}
                  onChange={(v) => setPp({ includeNumber: v })}
                />
              </Option>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
