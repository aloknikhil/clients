import { useEffect, useState } from "preact/hooks";

import { t } from "../../lib/i18n";
import { call, type VaultItem } from "../../lib/rpc";
import { ErrorText, Icon, Tile, Topbar } from "../components";

export function Trash({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const [items, setItems] = useState<VaultItem[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    call("listTrash").then(
      (all) =>
        setItems(all.sort((a, b) => (b.deletedDate ?? "").localeCompare(a.deletedDate ?? ""))),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  return (
    <div class="view">
      <Topbar title={t("trash")} onBack={onBack} />
      <div class="scroll">
        <ErrorText error={error} />
        {items !== undefined && items.length === 0 && (
          <div class="empty">
            <Icon name="trash" size={18} />
            {t("trashEmpty")}
          </div>
        )}
        {items?.map((item) => (
          <button key={item.id} type="button" class="item" onClick={() => onOpen(item.id)}>
            <Tile item={item} />
            <span class="item-text">
              <span class="item-name">{item.name}</span>
              <span class="item-sub">
                {t(
                  "deletedOn",
                  new Date(item.deletedDate ?? item.revisionDate).toLocaleDateString(),
                )}
              </span>
            </span>
          </button>
        ))}
      </div>
      <footer class="statusbar">
        <span>{t("trashHint")}</span>
      </footer>
    </div>
  );
}
