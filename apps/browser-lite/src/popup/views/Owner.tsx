import type { CipherView } from "@bitwarden/sdk-internal";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../lib/i18n";
import { ownerIn, personalAllowed } from "../../lib/owner";
import { call, type ItemOwner, type Organization } from "../../lib/rpc";
import { ErrorText, Icon, Spinner, Switch, Topbar, useAction, useToast } from "../components";

const PERSONAL = "";

/** Organization name, or "My vault" for personal items. */
export function ownerName(orgs: Organization[], organizationId?: string): string {
  return orgs.find((o) => o.id === organizationId)?.name ?? t("myVault");
}

/** Names of an item's collections the user can see, in the order the org lists them. */
export function collectionNames(orgs: Organization[], owner: ItemOwner): string[] {
  const org = orgs.find((o) => o.id === owner.organizationId);
  return (org?.collections ?? [])
    .filter((c) => owner.collectionIds.includes(c.id))
    .map((c) => c.name);
}

/**
 * Owner and collections for an item. `fixed` collections are ones the item is already in but the
 * user can't add to: they're shown, and stay.
 */
export function OwnerPicker({
  orgs,
  value,
  fixed = [],
  onChange,
}: {
  orgs: Organization[];
  value: ItemOwner;
  fixed?: string[];
  onChange: (owner: ItemOwner) => void;
}) {
  const org = orgs.find((o) => o.id === value.organizationId);
  const toggle = (id: string, on: boolean) =>
    onChange({
      ...value,
      collectionIds: on
        ? [...value.collectionIds, id]
        : value.collectionIds.filter((c) => c !== id),
    });

  return (
    <>
      <div class="group">
        <div class="option">
          <span class="muted">{t("owner")}</span>
          <select
            class="input"
            aria-label={t("owner")}
            value={value.organizationId ?? PERSONAL}
            onChange={(e) => {
              const id = e.currentTarget.value;
              const next = orgs.find((o) => o.id === id);
              onChange(next ? ownerIn(next) : { collectionIds: [] });
            }}
          >
            {(personalAllowed(orgs) || value.organizationId === undefined) && (
              <option value={PERSONAL}>{t("myVault")}</option>
            )}
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {org && (
        <>
          <div class="group-title label">{t("collections")}</div>
          <div class="group">
            {org.collections
              .filter((c) => c.canAddItems || fixed.includes(c.id))
              .map((c) => (
                <div class="option" key={c.id}>
                  <span class="option-name">
                    {c.name}
                    {c.isDefault && <span class="badge">{t("default")}</span>}
                  </span>
                  {c.canAddItems ? (
                    <Switch
                      checked={value.collectionIds.includes(c.id)}
                      label={c.name}
                      onChange={(on) => toggle(c.id, on)}
                    />
                  ) : (
                    <span class="faint" title={t("readOnlyCollection")}>
                      <Icon name="lock" size={13} />
                    </span>
                  )}
                </div>
              ))}
            {!org.collections.some((c) => c.canAddItems) && (
              <div class="option faint">{t("noWritableCollections")}</div>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** Explains what a move will do, since moving out of an organization is a copy. */
function moveNote(orgs: Organization[], from: ItemOwner, to: ItemOwner): string | undefined {
  if (from.organizationId === to.organizationId) {
    return from.organizationId === undefined ? undefined : t("moveNoteCollections");
  }
  if (from.organizationId === undefined) {
    return t("moveNoteShare", ownerName(orgs, to.organizationId));
  }
  return t("moveNoteCopy", ownerName(orgs, to.organizationId));
}

export function Move({
  id,
  onDone,
  onCancel,
}: {
  id: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const [cipher, setCipher] = useState<CipherView>();
  const [orgs, setOrgs] = useState<Organization[]>();
  const [owner, setOwner] = useState<ItemOwner>({ collectionIds: [] });
  const [error, setError] = useState<string>();
  const toast = useToast();

  useEffect(() => {
    Promise.all([call("getCipher", id), call("listOrganizations")]).then(
      ([c, o]) => {
        setCipher(c);
        setOrgs(o);
        setOwner({
          organizationId: c.organizationId === undefined ? undefined : String(c.organizationId),
          collectionIds: (c.collectionIds ?? []).map(String),
        });
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [id]);

  const move = useAction(async () => {
    const movedId = await call("moveCipher", id, owner);
    toast(t("itemMoved"));
    onDone(movedId);
  });

  if (!cipher || !orgs) {
    return (
      <div class="view">
        <Topbar title={t("move")} onBack={onCancel} />
        <div class="splash faint">{error ? <ErrorText error={error} /> : <Spinner />}</div>
      </div>
    );
  }

  const from: ItemOwner = {
    organizationId: cipher.organizationId === undefined ? undefined : String(cipher.organizationId),
    collectionIds: (cipher.collectionIds ?? []).map(String),
  };
  const note = moveNote(orgs, from, owner);
  const unchanged =
    from.organizationId === owner.organizationId &&
    from.collectionIds.length === owner.collectionIds.length &&
    from.collectionIds.every((c) => owner.collectionIds.includes(c));
  const needsCollection = owner.organizationId !== undefined && owner.collectionIds.length === 0;

  return (
    <div class="view">
      <Topbar title={t("move")} onBack={onCancel}>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          class="btn primary"
          style={{ height: "28px" }}
          disabled={move.busy || unchanged || needsCollection}
          onClick={() => void move.run()}
        >
          {move.busy ? <Spinner /> : <Icon name="move" size={14} />}
          {t("move")}
        </button>
      </Topbar>
      <div class="scroll" style={{ padding: "12px 0" }}>
        <p class="move-item">{cipher.name}</p>
        <div style={{ padding: "0 12px" }}>
          <ErrorText error={error ?? move.error} />
        </div>
        <OwnerPicker
          orgs={orgs}
          value={owner}
          fixed={owner.organizationId === from.organizationId ? from.collectionIds : []}
          onChange={setOwner}
        />
        {note && <p class="muted move-note">{note}</p>}
      </div>
    </div>
  );
}
