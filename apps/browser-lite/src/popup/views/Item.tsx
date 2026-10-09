import type { CipherView, TotpResponse } from "@bitwarden/sdk-internal";
import type { ComponentChildren, VNode } from "preact";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../lib/i18n";
import { call, ItemKind, type Organization } from "../../lib/rpc";
import { toUrl } from "../../lib/url";
import {
  ErrorText,
  Icon,
  IconButton,
  Secret,
  Tile,
  Topbar,
  useAction,
  useToast,
} from "../components";

import { collectionNames, ownerName } from "./Owner";

/** Server `FieldType`: 0 text, 1 hidden, 2 boolean, 3 linked. */
const HIDDEN_FIELD = 1;
const MASK = "••••••••••••";

function Field({
  label,
  value,
  hidden = false,
  mono = false,
  children,
}: {
  label: string;
  value?: string;
  hidden?: boolean;
  mono?: boolean;
  children?: ComponentChildren;
}) {
  const [revealed, setRevealed] = useState(false);
  const toast = useToast();
  if (!value) {
    return null;
  }
  return (
    <div class="field">
      <div class="field-body">
        <div class="label">{label}</div>
        <div class={hidden || mono ? "field-value secret" : "field-value"}>
          {hidden && !revealed ? MASK : hidden ? <Secret value={value} /> : value}
        </div>
      </div>
      <div class="field-actions">
        {children}
        {hidden && (
          <IconButton
            icon={revealed ? "eyeOff" : "eye"}
            label={revealed ? t("hide") : t("show")}
            onClick={() => setRevealed(!revealed)}
          />
        )}
        <IconButton
          icon="copy"
          label={t("copyValue", label)}
          onClick={() => void call("copyText", value).then(() => toast(t("valueCopied", label)))}
        />
      </div>
    </div>
  );
}

/** A `<Field>` with no value renders nothing, but is still a truthy child; look at its props. */
function hasContent(child: unknown): boolean {
  if (Array.isArray(child)) {
    return child.some(hasContent);
  }
  if (child == null || child === false) {
    return false;
  }
  const vnode = child as VNode<{ value?: string }>;
  return vnode.type !== Field || !!vnode.props.value;
}

function Group({ title, children }: { title?: string; children: ComponentChildren }) {
  if (!hasContent(children)) {
    return null;
  }
  return (
    <>
      {title && <div class="group-title label">{title}</div>}
      <div class="group">{children}</div>
    </>
  );
}

function TotpRing({ remaining, period }: { remaining: number; period: number }) {
  const r = 8;
  const circumference = 2 * Math.PI * r;
  return (
    <svg
      class={remaining <= 5 ? "totp-ring expiring" : "totp-ring"}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-label={t("secondsLeft", String(remaining))}
    >
      <circle class="track" cx="10" cy="10" r={r} />
      <circle
        class="progress"
        cx="10"
        cy="10"
        r={r}
        stroke-dasharray={circumference}
        stroke-dashoffset={circumference * (1 - remaining / period)}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

function Totp({ id }: { id: string }) {
  const [totp, setTotp] = useState<TotpResponse>();
  const [now, setNow] = useState(Date.now());
  const toast = useToast();
  const remaining = totp ? totp.period - (Math.floor(now / 1000) % totp.period) : 0;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // Refetch whenever a new period starts.
  useEffect(() => {
    void call("totp", id).then(setTotp);
  }, [id, totp === undefined || remaining === totp.period]);

  if (!totp) {
    return null;
  }
  const grouped =
    totp.code.length === 6 ? `${totp.code.slice(0, 3)} ${totp.code.slice(3)}` : totp.code;
  return (
    <div class="field">
      <div class="field-body">
        <div class="label">{t("oneTimeCode")}</div>
        <div class="totp">
          <span class="totp-code">{grouped}</span>
          <TotpRing remaining={remaining} period={totp.period} />
        </div>
      </div>
      <div class="field-actions">
        <IconButton
          icon="copy"
          label={t("copyOneTimeCode")}
          onClick={() =>
            void call("copyText", totp.code).then(() => toast(t("valueCopied", t("oneTimeCode"))))
          }
        />
      </div>
    </div>
  );
}

const KIND_BY_TYPE: Record<number, VaultKind> = {
  1: ItemKind.Login,
  2: ItemKind.Note,
  3: ItemKind.Card,
  4: ItemKind.Identity,
  5: ItemKind.SshKey,
};
type VaultKind = (typeof ItemKind)[keyof typeof ItemKind];

type Pending = "trash" | "deleteForever";

export function Item({
  id,
  onBack,
  onEdit,
  onMove,
}: {
  id: string;
  onBack: () => void;
  onEdit: (id: string) => void;
  onMove: (id: string) => void;
}) {
  const [cipher, setCipher] = useState<CipherView>();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState<Pending>();
  const toast = useToast();

  const load = () =>
    call("getCipher", id).then(setCipher, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  useEffect(() => void load(), [id]);
  useEffect(() => void call("listOrganizations").then(setOrgs, () => undefined), []);

  const act = useAction(async (action: "favorite" | "trash" | "restore" | "deleteForever") => {
    if (action === "favorite") {
      await call("setFavorite", id, !cipher!.favorite);
      await load();
    } else if (action === "trash") {
      await call("trashCipher", id);
      toast(t("movedToTrash"));
      onBack();
    } else if (action === "restore") {
      await call("restoreCipher", id);
      toast(t("itemRestored"));
      onBack();
    } else {
      await call("deleteCipherForever", id);
      toast(t("itemDeleted"));
      onBack();
    }
  });
  const deleted = cipher?.deletedDate !== undefined && cipher?.deletedDate !== null;

  const login = cipher?.login;
  const card = cipher?.card;
  const identity = cipher?.identity;
  const fullName = [identity?.title, identity?.firstName, identity?.middleName, identity?.lastName]
    .filter(Boolean)
    .join(" ");
  const address = [
    identity?.address1,
    identity?.address2,
    identity?.address3,
    [identity?.city, identity?.state, identity?.postalCode].filter(Boolean).join(", "),
    identity?.country,
  ]
    .filter(Boolean)
    .join("\n");
  const firstHost = login?.uris?.map((u) => (u.uri ? toUrl(u.uri)?.host : undefined)).find(Boolean);

  return (
    <div class="view">
      <Topbar onBack={onBack}>
        <span style={{ flex: 1 }} />
        {cipher && !deleted && (
          <>
            <IconButton
              icon="star"
              filled={cipher.favorite}
              active={cipher.favorite}
              label={cipher.favorite ? t("unfavorite") : t("favorite")}
              onClick={() => void act.run("favorite")}
            />
            {orgs.length > 0 && cipher.edit && (
              <IconButton icon="move" label={t("move")} onClick={() => onMove(id)} />
            )}
            <IconButton icon="trash" label={t("moveToTrash")} onClick={() => setConfirm("trash")} />
            {cipher.edit && (
              <button
                type="button"
                class="btn"
                style={{ height: "28px" }}
                onClick={() => onEdit(id)}
              >
                <Icon name="pencil" size={14} />
                {t("edit")}
              </button>
            )}
          </>
        )}
        {cipher && deleted && (
          <>
            <IconButton
              icon="trash"
              label={t("deleteForever")}
              onClick={() => setConfirm("deleteForever")}
            />
            <button
              type="button"
              class="btn"
              style={{ height: "28px" }}
              onClick={() => void act.run("restore")}
            >
              <Icon name="restore" size={14} />
              {t("restore")}
            </button>
          </>
        )}
      </Topbar>
      <div class="scroll" style={{ padding: "0 0 12px" }}>
        <ErrorText error={error ?? act.error} />
        {cipher && (
          <>
            <div class="hero">
              <Tile
                item={{
                  name: cipher.name,
                  kind: KIND_BY_TYPE[cipher.type] ?? ItemKind.Other,
                  uris: (login?.uris ?? []).map((u) => u.uri ?? ""),
                }}
                large
              />
              <div style={{ minWidth: 0 }}>
                <h1 class="title">{cipher.name}</h1>
                {firstHost && (
                  <div class="faint mono" style={{ fontSize: "12px" }}>
                    {firstHost}
                  </div>
                )}
                {cipher.organizationId !== undefined && (
                  <div class="owner-line" title={t("owner")}>
                    <Icon name="org" size={12} />
                    <span>
                      {[
                        ownerName(orgs, String(cipher.organizationId)),
                        collectionNames(orgs, {
                          organizationId: String(cipher.organizationId),
                          collectionIds: (cipher.collectionIds ?? []).map(String),
                        }).join(", "),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <Group>
              <Field label={t("username")} value={login?.username} />
              <Field label={t("password")} value={login?.password} hidden />
              {login?.totp && <Totp id={id} />}
              {(login?.fido2Credentials ?? []).map((passkey) => (
                <div class="field" key={passkey.credentialId}>
                  <div class="field-body">
                    <div class="label">{t("passkey")}</div>
                    <div class="field-value">
                      {passkey.userName || passkey.rpId}
                      <span class="faint" style={{ fontSize: "12px" }}>
                        {" · "}
                        {t("createdOn", new Date(passkey.creationDate).toLocaleDateString())}
                      </span>
                    </div>
                  </div>
                  <span class="badge">{passkey.rpId}</span>
                </div>
              ))}
            </Group>

            <Group>
              {(login?.uris ?? [])
                .filter((u) => u.uri)
                .map((u, i) => {
                  const href = toUrl(u.uri!)?.href;
                  return (
                    <Field key={i} label={t("website")} value={u.uri}>
                      {href && /^https?:/.test(href) && (
                        <IconButton
                          icon="external"
                          label={t("launch")}
                          onClick={() => void chrome.tabs.create({ url: href })}
                        />
                      )}
                    </Field>
                  );
                })}
            </Group>

            <Group>
              <Field label={t("cardholderName")} value={card?.cardholderName} />
              <Field label={t("number")} value={card?.number} hidden />
              <Field
                label={t("expiration")}
                mono
                value={
                  card?.expMonth || card?.expYear
                    ? `${card?.expMonth ?? "··"} / ${card?.expYear ?? "····"}`
                    : undefined
                }
              />
              <Field label={t("securityCode")} value={card?.code} hidden />
            </Group>

            <Group>
              <Field label={t("name")} value={fullName} />
              <Field label={t("email")} value={identity?.email} />
              <Field label={t("phone")} value={identity?.phone} />
              <Field label={t("address")} value={address} />
              <Field label={t("company")} value={identity?.company} />
            </Group>

            <Group>
              <Field label={t("publicKey")} value={cipher.sshKey?.publicKey} mono />
              <Field label={t("fingerprint")} value={cipher.sshKey?.fingerprint} mono />
              <Field label={t("privateKey")} value={cipher.sshKey?.privateKey} hidden />
            </Group>

            <Group title={t("customFields")}>
              {(cipher.fields ?? []).map((f, i) => (
                <Field
                  key={i}
                  label={f.name ?? ""}
                  value={f.value ?? undefined}
                  hidden={f.type === HIDDEN_FIELD}
                />
              ))}
            </Group>

            <Group>
              <Field label={t("notes")} value={cipher.notes} />
            </Group>

            <div class="meta">
              {t("updated")} {new Date(cipher.revisionDate).toLocaleString()}
            </div>
          </>
        )}
      </div>
      {confirm && (
        <div class="confirm-bar" role="alertdialog">
          <span>{confirm === "trash" ? t("moveToTrashQuestion") : t("deleteForeverQuestion")}</span>
          <span class="spacer" />
          <button
            type="button"
            class="btn ghost"
            style={{ height: "28px" }}
            onClick={() => setConfirm(undefined)}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            class="btn danger-solid"
            style={{ height: "28px" }}
            autoFocus
            disabled={act.busy}
            onClick={() => {
              const action = confirm;
              setConfirm(undefined);
              void act.run(action);
            }}
          >
            {confirm === "trash" ? t("moveToTrash") : t("deleteForever")}
          </button>
        </div>
      )}
    </div>
  );
}
