import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import { t } from "../lib/i18n";
import type { FillResult, VaultItem } from "../lib/rpc";
import { Icon, IconsContext, Mark, Spinner, Tile } from "../popup/components";

interface Items {
  locked: boolean;
  items: VaultItem[];
  iconsBase?: string;
}

/** The menu's narrow channel: the service worker scopes every request to this frame's tab. */
function send<T>(request: object): Promise<T> {
  return chrome.runtime.sendMessage(request) as Promise<T>;
}

function Menu() {
  const [data, setData] = useState<Items>();
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    void send<Items>({ inlineMenu: "items" }).then(setData);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && void send({ inlineMenu: "close" });
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  async function fill(item: VaultItem) {
    if (item.reprompt) {
      await send({ inlineMenu: "openPopup" });
      return;
    }
    setBusy(item.id);
    await send<FillResult>({ inlineMenu: "fill", id: item.id });
  }

  return (
    <IconsContext.Provider value={data?.iconsBase}>
      <div class="inline-head">
        <Mark size={14} />
        <span class="label">{t("extName")}</span>
      </div>
      {data === undefined && (
        <div class="inline-empty">
          <Spinner />
        </div>
      )}
      {data?.locked && (
        <button type="button" class="item" onClick={() => void send({ inlineMenu: "openPopup" })}>
          <span class="tile">
            <Icon name="lock" size={15} />
          </span>
          <span class="item-text">
            <span class="item-name">{t("vaultLockedInline")}</span>
            <span class="item-sub">{t("unlockToFill")}</span>
          </span>
        </button>
      )}
      {data?.items.map((item) => (
        <button
          key={item.id}
          type="button"
          class="item"
          disabled={busy !== undefined}
          onClick={() => void fill(item)}
        >
          <Tile item={item} />
          <span class="item-text">
            <span class="item-name">{item.name}</span>
            <span class="item-sub">{item.subtitle || item.uris[0]}</span>
          </span>
          {busy === item.id ? <Spinner /> : item.reprompt ? <Icon name="lock" size={14} /> : null}
        </button>
      ))}
    </IconsContext.Provider>
  );
}

render(<Menu />, document.getElementById("app")!);
