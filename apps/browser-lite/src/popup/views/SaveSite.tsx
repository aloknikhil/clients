import { t } from "../../lib/i18n";
import type { VaultItem } from "../../lib/rpc";
import { ErrorText, Icon, Tile, useAction } from "../components";

/** Shown after filling on a page the item doesn't list: offer to remember it. */
export function SaveSite({
  item,
  host,
  onSave,
  onDismiss,
}: {
  item: VaultItem;
  host: string;
  onSave: () => Promise<void>;
  onDismiss: () => void;
}) {
  const save = useAction(onSave);
  return (
    <div class="view">
      <div class="auth">
        <div class="auth-head">
          <span class="row" style={{ gap: "10px", marginBottom: "6px" }}>
            <Tile item={item} large />
            <Icon name="check" size={18} />
          </span>
          <span class="label">{t("filled")}</span>
          <h1 class="title">{t("saveSiteTitle", host)}</h1>
          <p class="muted" style={{ margin: 0 }}>
            {t("saveSiteDesc", item.name)}
          </p>
        </div>
        <div class="stack">
          <ErrorText error={save.error} />
          <button
            type="button"
            class="btn primary block"
            autoFocus
            disabled={save.busy}
            onClick={() => void save.run()}
          >
            <Icon name="globe" size={15} />
            {t("saveSite")}
          </button>
          <button type="button" class="btn ghost block" onClick={onDismiss}>
            {t("notNow")}
          </button>
        </div>
      </div>
    </div>
  );
}
