import type {
  CardView,
  CipherView,
  FieldView,
  IdentityView,
  LoginUriView,
  LoginView,
  TotpResponse,
} from "@bitwarden/sdk-internal";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../lib/i18n";
import { defaultOwner } from "../../lib/owner";
import { call, type Folder, type Organization } from "../../lib/rpc";
import {
  ErrorText,
  Icon,
  IconButton,
  Spinner,
  Switch,
  Topbar,
  useAction,
  useToast,
} from "../components";

import { OwnerPicker } from "./Owner";

/** SDK `CipherType` and `FieldType`. */
export const CipherType = Object.freeze({
  Login: 1,
  SecureNote: 2,
  Card: 3,
  Identity: 4,
  SshKey: 5,
} as const);
type CipherTypeValue = (typeof CipherType)[keyof typeof CipherType];
const FieldType = Object.freeze({ Text: 0, Hidden: 1, Boolean: 2 } as const);

const MATCH_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "matchDefault" },
  { value: "0", label: "matchDomain" },
  { value: "1", label: "matchHost" },
  { value: "2", label: "matchStartsWith" },
  { value: "3", label: "matchExact" },
  { value: "4", label: "matchRegex" },
  { value: "5", label: "matchNever" },
];

const CARD_BRANDS = [
  "Visa",
  "Mastercard",
  "Amex",
  "Discover",
  "Diners Club",
  "JCB",
  "Maestro",
  "UnionPay",
  "RuPay",
  "Other",
];

const GENERATOR_KEY = "generatorOptions";

function blankLogin(uri?: string): LoginView {
  return {
    username: undefined,
    password: undefined,
    passwordRevisionDate: undefined,
    uris: uri ? [{ uri, match: undefined, uriChecksum: undefined }] : [],
    totp: undefined,
    autofillOnPageLoad: undefined,
    fido2Credentials: undefined,
  };
}

function blankView(type: CipherTypeValue, name = "", uri?: string): CipherView {
  const now = new Date().toISOString();
  return {
    id: undefined,
    organizationId: undefined,
    folderId: undefined,
    collectionIds: [],
    key: undefined,
    name,
    notes: undefined,
    type,
    login: type === CipherType.Login ? blankLogin(uri) : undefined,
    card:
      type === CipherType.Card
        ? {
            cardholderName: undefined,
            expMonth: undefined,
            expYear: undefined,
            code: undefined,
            brand: undefined,
            number: undefined,
          }
        : undefined,
    identity: type === CipherType.Identity ? ({} as IdentityView) : undefined,
    secureNote: type === CipherType.SecureNote ? { type: 0 } : undefined,
    sshKey: undefined,
    bankAccount: undefined,
    driversLicense: undefined,
    passport: undefined,
    favorite: false,
    reprompt: 0,
    organizationUseTotp: false,
    edit: true,
    permissions: undefined,
    viewPassword: true,
    localData: undefined,
    attachments: undefined,
    fields: [],
    passwordHistory: undefined,
    creationDate: now,
    deletedDate: undefined,
    revisionDate: now,
    archivedDate: undefined,
  } as unknown as CipherView;
}

/** Label-over-input row inside a group card. */
function Row({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <label class="edit-row">
      <span class="label">{label}</span>
      <span class="edit-control">{children}</span>
    </label>
  );
}

function TextRow({
  label,
  value,
  onChange,
  mono = false,
  type = "text",
  placeholder,
  autoFocus = false,
  children,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  mono?: boolean;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
  children?: ComponentChildren;
}) {
  return (
    <Row label={label}>
      <input
        class={mono ? "bare mono" : "bare"}
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellcheck={false}
        autoComplete="off"
        onInput={(e) => onChange(e.currentTarget.value === "" ? undefined : e.currentTarget.value)}
      />
      {children}
    </Row>
  );
}

function TotpEditor({
  value,
  onChange,
  tabId,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  tabId?: number;
}) {
  const [preview, setPreview] = useState<TotpResponse>();
  const toast = useToast();
  useEffect(() => {
    let current = true;
    const refresh = () =>
      void call("previewTotp", value ?? "").then(
        (p) => current && setPreview(p),
        () => current && setPreview(undefined),
      );
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [value]);
  const scan = useAction(async () => {
    const uri = await call("scanTotpQr", tabId!);
    if (uri) {
      onChange(uri);
      toast(t("qrFound"));
    } else {
      toast(t("qrNotFound"));
    }
  });
  const invalid = !!value && preview === undefined;
  return (
    <Row label={t("authenticatorKey")}>
      <input
        class="bare mono"
        value={value ?? ""}
        placeholder={t("authenticatorKeyPlaceholder")}
        spellcheck={false}
        autoComplete="off"
        onInput={(e) => onChange(e.currentTarget.value === "" ? undefined : e.currentTarget.value)}
      />
      {preview && (
        <span class="totp-chip mono">{preview.code.replace(/^(\d{3})(\d{3})$/, "$1 $2")}</span>
      )}
      {invalid && <span class="totp-chip invalid">{t("invalid")}</span>}
      {tabId !== undefined && (
        <IconButton icon="scan" label={t("scanQrOnPage")} onClick={() => void scan.run()} />
      )}
    </Row>
  );
}

export function Edit({
  id,
  type,
  onSaved,
  onCancel,
}: {
  id?: string;
  type?: CipherTypeValue;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const [view, setView] = useState<CipherView>();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [tabId, setTabId] = useState<number>();
  const [revealed, setRevealed] = useState(false);
  const [newFolder, setNewFolder] = useState<string>();
  const [error, setError] = useState<string>();
  const toast = useToast();

  useEffect(() => {
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const web = tab?.url && /^https?:/.test(tab.url) ? new URL(tab.url) : undefined;
        setTabId(web ? tab.id : undefined);
        const [folderList, orgList] = await Promise.all([
          call("listFolders"),
          call("listOrganizations"),
        ]);
        setFolders(folderList);
        setOrgs(orgList);
        if (id !== undefined) {
          setView(await call("getCipher", id));
        } else {
          const kind = type ?? CipherType.Login;
          const name = kind === CipherType.Login && web ? web.hostname.replace(/^www\./, "") : "";
          const owner = defaultOwner(orgList);
          setView({
            ...blankView(kind, name, kind === CipherType.Login ? web?.origin : undefined),
            organizationId: owner.organizationId as never,
            collectionIds: owner.collectionIds as never,
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [id, type]);

  const save = useAction(async () => {
    let folderId = view!.folderId;
    if (newFolder !== undefined && newFolder.trim() !== "") {
      folderId = (await call("createFolder", newFolder)).id as never;
    }
    const savedId = await call("saveCipher", { ...view!, folderId });
    toast(t("itemSaved"));
    onSaved(savedId);
  });

  if (!view) {
    return (
      <div class="view">
        <Topbar onBack={onCancel} />
        <div class="splash faint">{error ? <ErrorText error={error} /> : <Spinner />}</div>
      </div>
    );
  }

  const patch = (p: Partial<CipherView>) => setView({ ...view, ...p });
  const login = view.login;
  const setLogin = (p: Partial<LoginView>) => patch({ login: { ...login!, ...p } });
  const uris = login?.uris ?? [];
  const setUri = (i: number, p: Partial<LoginUriView>) =>
    setLogin({ uris: uris.map((u, j) => (j === i ? { ...u, ...p } : u)) });
  const card = view.card;
  const setCard = (p: Partial<CardView>) => patch({ card: { ...card!, ...p } });
  const identity = view.identity;
  const setIdentity = (p: Partial<IdentityView>) => patch({ identity: { ...identity!, ...p } });
  const fields = view.fields ?? [];
  const setField = (i: number, p: Partial<FieldView>) =>
    patch({ fields: fields.map((f, j) => (j === i ? { ...f, ...p } : f)) });
  const addField = (fieldType: number) =>
    patch({
      fields: [
        ...fields,
        { name: undefined, value: undefined, type: fieldType as never, linkedId: undefined },
      ],
    });
  const restricted = id !== undefined && !view.edit;

  async function generatePassword() {
    const stored = (await chrome.storage.local.get(GENERATOR_KEY))[GENERATOR_KEY] as
      { kind?: string; password?: object; passphrase?: object } | undefined;
    const password = await call(
      "generate",
      stored?.kind === "passphrase" && stored.passphrase
        ? { kind: "passphrase", options: stored.passphrase as never }
        : {
            kind: "password",
            options: (stored?.password as never) ?? {
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
          },
    );
    setLogin({ password });
    setRevealed(true);
  }

  const title = id !== undefined ? t("editItem") : t("newItem");

  return (
    <div class="view">
      <Topbar title={title} onBack={onCancel}>
        <button
          type="button"
          class="btn primary"
          style={{ height: "28px" }}
          disabled={save.busy || (view.organizationId !== undefined && !view.collectionIds?.length)}
          onClick={() => void save.run()}
        >
          {save.busy ? <Spinner /> : null}
          {t("save")}
        </button>
      </Topbar>
      <form
        class="scroll"
        style={{ padding: "12px 0" }}
        onSubmit={(e) => {
          e.preventDefault();
          void save.run();
        }}
      >
        <div style={{ padding: "0 12px" }}>
          <ErrorText error={save.error ?? error} />
        </div>
        {restricted && (
          <p class="muted" style={{ padding: "0 16px", margin: "0 0 10px" }}>
            {t("readOnlyItem")}
          </p>
        )}

        <fieldset class="plain" disabled={restricted}>
          <div class="group">
            <TextRow
              label={t("name")}
              value={view.name}
              onChange={(v) => patch({ name: v ?? "" })}
              autoFocus={id === undefined}
            />
          </div>

          {login && (
            <div class="group">
              <TextRow
                label={t("username")}
                value={login.username}
                onChange={(v) => setLogin({ username: v })}
              />
              {view.viewPassword && (
                <TextRow
                  label={t("password")}
                  value={login.password}
                  onChange={(v) => setLogin({ password: v })}
                  type={revealed ? "text" : "password"}
                  mono
                >
                  <IconButton
                    icon={revealed ? "eyeOff" : "eye"}
                    label={revealed ? t("hide") : t("show")}
                    onClick={() => setRevealed(!revealed)}
                  />
                  <IconButton
                    icon="wand"
                    label={t("generatePassword")}
                    onClick={() => void generatePassword()}
                  />
                </TextRow>
              )}
              {view.viewPassword && (
                <TotpEditor
                  value={login.totp}
                  onChange={(v) => setLogin({ totp: v })}
                  tabId={tabId}
                />
              )}
            </div>
          )}

          {login && (
            <>
              <div class="group-title label">{t("websites")}</div>
              <div class="group">
                {uris.map((u, i) => (
                  <Row key={i} label={t("website")}>
                    <input
                      class="bare mono"
                      value={u.uri ?? ""}
                      placeholder="https://example.com"
                      spellcheck={false}
                      onInput={(e) => setUri(i, { uri: e.currentTarget.value })}
                    />
                    <select
                      class="mini-select"
                      aria-label={t("matchDetection")}
                      value={u.match === undefined || u.match === null ? "" : String(u.match)}
                      onChange={(e) =>
                        setUri(i, {
                          match:
                            e.currentTarget.value === ""
                              ? undefined
                              : (Number(e.currentTarget.value) as never),
                        })
                      }
                    >
                      {MATCH_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {t(o.label)}
                        </option>
                      ))}
                    </select>
                    <IconButton
                      icon="close"
                      label={t("remove")}
                      onClick={() => setLogin({ uris: uris.filter((_, j) => j !== i) })}
                    />
                  </Row>
                ))}
                <button
                  type="button"
                  class="add-row"
                  onClick={() =>
                    setLogin({
                      uris: [...uris, { uri: "", match: undefined, uriChecksum: undefined }],
                    })
                  }
                >
                  <Icon name="plus" size={15} />
                  {t("addWebsite")}
                </button>
              </div>
            </>
          )}

          {card && (
            <div class="group">
              <TextRow
                label={t("cardholderName")}
                value={card.cardholderName}
                onChange={(v) => setCard({ cardholderName: v })}
              />
              <TextRow
                label={t("number")}
                value={card.number}
                onChange={(v) => setCard({ number: v })}
                mono
              />
              <Row label={t("brand")}>
                <select
                  class="bare"
                  value={card.brand ?? ""}
                  onChange={(e) => setCard({ brand: e.currentTarget.value || undefined })}
                >
                  <option value="">—</option>
                  {CARD_BRANDS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label={t("expiration")}>
                <select
                  class="bare"
                  style={{ width: "72px" }}
                  value={card.expMonth ?? ""}
                  onChange={(e) => setCard({ expMonth: e.currentTarget.value || undefined })}
                >
                  <option value="">MM</option>
                  {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((m) => (
                    <option key={m} value={m}>
                      {m.padStart(2, "0")}
                    </option>
                  ))}
                </select>
                <span class="faint">/</span>
                <input
                  class="bare mono"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="YYYY"
                  value={card.expYear ?? ""}
                  onInput={(e) => setCard({ expYear: e.currentTarget.value || undefined })}
                />
              </Row>
              <TextRow
                label={t("securityCode")}
                value={card.code}
                onChange={(v) => setCard({ code: v })}
                mono
                type={revealed ? "text" : "password"}
              >
                <IconButton
                  icon={revealed ? "eyeOff" : "eye"}
                  label={revealed ? t("hide") : t("show")}
                  onClick={() => setRevealed(!revealed)}
                />
              </TextRow>
            </div>
          )}

          {identity && (
            <>
              <div class="group">
                <Row label={t("titleHonorific")}>
                  <select
                    class="bare"
                    value={identity.title ?? ""}
                    onChange={(e) => setIdentity({ title: e.currentTarget.value || undefined })}
                  >
                    <option value="">—</option>
                    {["Mr", "Mrs", "Ms", "Mx", "Dr"].map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </Row>
                <TextRow
                  label={t("firstName")}
                  value={identity.firstName}
                  onChange={(v) => setIdentity({ firstName: v })}
                />
                <TextRow
                  label={t("middleName")}
                  value={identity.middleName}
                  onChange={(v) => setIdentity({ middleName: v })}
                />
                <TextRow
                  label={t("lastName")}
                  value={identity.lastName}
                  onChange={(v) => setIdentity({ lastName: v })}
                />
              </div>
              <div class="group">
                <TextRow
                  label={t("username")}
                  value={identity.username}
                  onChange={(v) => setIdentity({ username: v })}
                />
                <TextRow
                  label={t("company")}
                  value={identity.company}
                  onChange={(v) => setIdentity({ company: v })}
                />
                <TextRow
                  label={t("email")}
                  value={identity.email}
                  onChange={(v) => setIdentity({ email: v })}
                  type="email"
                />
                <TextRow
                  label={t("phone")}
                  value={identity.phone}
                  onChange={(v) => setIdentity({ phone: v })}
                  type="tel"
                />
              </div>
              <div class="group">
                <TextRow
                  label={t("address1")}
                  value={identity.address1}
                  onChange={(v) => setIdentity({ address1: v })}
                />
                <TextRow
                  label={t("address2")}
                  value={identity.address2}
                  onChange={(v) => setIdentity({ address2: v })}
                />
                <TextRow
                  label={t("city")}
                  value={identity.city}
                  onChange={(v) => setIdentity({ city: v })}
                />
                <TextRow
                  label={t("stateProvince")}
                  value={identity.state}
                  onChange={(v) => setIdentity({ state: v })}
                />
                <TextRow
                  label={t("postalCode")}
                  value={identity.postalCode}
                  onChange={(v) => setIdentity({ postalCode: v })}
                />
                <TextRow
                  label={t("country")}
                  value={identity.country}
                  onChange={(v) => setIdentity({ country: v })}
                />
              </div>
              <div class="group">
                <TextRow
                  label={t("ssn")}
                  value={identity.ssn}
                  onChange={(v) => setIdentity({ ssn: v })}
                  mono
                />
                <TextRow
                  label={t("passportNumber")}
                  value={identity.passportNumber}
                  onChange={(v) => setIdentity({ passportNumber: v })}
                  mono
                />
                <TextRow
                  label={t("licenseNumber")}
                  value={identity.licenseNumber}
                  onChange={(v) => setIdentity({ licenseNumber: v })}
                  mono
                />
              </div>
            </>
          )}

          <div class="group-title label">{t("notes")}</div>
          <div class="group">
            <label class="edit-row">
              <textarea
                class="bare"
                rows={view.type === CipherType.SecureNote ? 8 : 3}
                aria-label={t("notes")}
                value={view.notes ?? ""}
                onInput={(e) => patch({ notes: e.currentTarget.value || undefined })}
              />
            </label>
          </div>

          <div class="group-title label">{t("customFields")}</div>
          <div class="group">
            {fields.map((f, i) => (
              <div class="edit-row" key={i}>
                <input
                  class="bare label-input"
                  placeholder={t("fieldName")}
                  value={f.name ?? ""}
                  onInput={(e) => setField(i, { name: e.currentTarget.value || undefined })}
                />
                <span class="edit-control">
                  {f.type === FieldType.Boolean ? (
                    <Switch
                      checked={f.value === "true"}
                      label={f.name ?? t("value")}
                      onChange={(v) => setField(i, { value: String(v) })}
                    />
                  ) : (
                    <input
                      class={f.type === FieldType.Hidden ? "bare mono" : "bare"}
                      type={f.type === FieldType.Hidden && !revealed ? "password" : "text"}
                      placeholder={t("value")}
                      value={f.value ?? ""}
                      onInput={(e) => setField(i, { value: e.currentTarget.value || undefined })}
                    />
                  )}
                  <span style={{ flex: 1 }} />
                  <IconButton
                    icon="close"
                    label={t("remove")}
                    onClick={() => patch({ fields: fields.filter((_, j) => j !== i) })}
                  />
                </span>
              </div>
            ))}
            <div class="add-row-group">
              <button type="button" class="add-row" onClick={() => addField(FieldType.Text)}>
                <Icon name="plus" size={15} />
                {t("textField")}
              </button>
              <button type="button" class="add-row" onClick={() => addField(FieldType.Hidden)}>
                <Icon name="plus" size={15} />
                {t("hiddenField")}
              </button>
              <button type="button" class="add-row" onClick={() => addField(FieldType.Boolean)}>
                <Icon name="plus" size={15} />
                {t("checkboxField")}
              </button>
            </div>
          </div>
        </fieldset>

        {id === undefined && orgs.length > 0 && (
          <OwnerPicker
            orgs={orgs}
            value={{
              organizationId:
                view.organizationId === undefined ? undefined : String(view.organizationId),
              collectionIds: (view.collectionIds ?? []).map(String),
            }}
            onChange={(owner) =>
              patch({
                organizationId: owner.organizationId as never,
                collectionIds: owner.collectionIds as never,
              })
            }
          />
        )}

        <div class="group-title label">{t("options")}</div>
        <div class="group">
          <div class="option">
            <span class="muted">{t("folder")}</span>
            {newFolder === undefined ? (
              <select
                class="input"
                aria-label={t("folder")}
                value={view.folderId ? String(view.folderId) : ""}
                onChange={(e) => {
                  if (e.currentTarget.value === "__new") {
                    setNewFolder("");
                  } else {
                    patch({ folderId: (e.currentTarget.value || undefined) as never });
                  }
                }}
              >
                <option value="">{t("noFolder")}</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
                <option value="__new">{t("newFolderEllipsis")}</option>
              </select>
            ) : (
              <span class="row">
                <input
                  class="input"
                  style={{ height: "28px", width: "148px" }}
                  autoFocus
                  placeholder={t("folderName")}
                  value={newFolder}
                  onInput={(e) => setNewFolder(e.currentTarget.value)}
                />
                <IconButton
                  icon="close"
                  label={t("cancel")}
                  onClick={() => setNewFolder(undefined)}
                />
              </span>
            )}
          </div>
          <div class="option">
            <span class="muted">{t("favorite")}</span>
            <Switch
              checked={view.favorite}
              label={t("favorite")}
              onChange={(v) => patch({ favorite: v })}
            />
          </div>
          <div class="option">
            <span class="muted">{t("masterPasswordReprompt")}</span>
            <Switch
              checked={view.reprompt !== 0}
              label={t("masterPasswordReprompt")}
              onChange={(v) => !restricted && patch({ reprompt: (v ? 1 : 0) as never })}
            />
          </div>
        </div>
        <button type="submit" hidden />
      </form>
    </div>
  );
}

/** Type picker for a new item. */
export function NewItem({
  onPick,
  onCancel,
}: {
  onPick: (type: CipherTypeValue) => void;
  onCancel: () => void;
}) {
  const options: {
    type: CipherTypeValue;
    icon: "globe" | "card" | "person" | "note";
    label: string;
    desc: string;
  }[] = [
    { type: CipherType.Login, icon: "globe", label: t("typeLogin"), desc: t("typeLoginDesc") },
    { type: CipherType.Card, icon: "card", label: t("typeCard"), desc: t("typeCardDesc") },
    {
      type: CipherType.Identity,
      icon: "person",
      label: t("typeIdentity"),
      desc: t("typeIdentityDesc"),
    },
    { type: CipherType.SecureNote, icon: "note", label: t("typeNote"), desc: t("typeNoteDesc") },
  ];
  return (
    <div class="view">
      <Topbar title={t("newItem")} onBack={onCancel} />
      <div class="scroll">
        {options.map((o, i) => (
          <button
            key={o.type}
            type="button"
            class="item"
            autoFocus={i === 0}
            onClick={() => onPick(o.type)}
          >
            <span class={`tile c${i * 2}`}>
              <Icon name={o.icon} size={15} />
            </span>
            <span class="item-text">
              <span class="item-name">{o.label}</span>
              <span class="item-sub">{o.desc}</span>
            </span>
            <Icon name="arrow" size={15} />
          </button>
        ))}
      </div>
    </div>
  );
}
