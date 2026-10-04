import { render } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import { t } from "../lib/i18n";
import type { PasskeyChoice, VaultItem } from "../lib/rpc";
import { Icon, IconsContext, Mark, passkeySubtitle, Spinner, Tile } from "../popup/components";

interface Items {
  locked: boolean;
  matches: VaultItem[];
  all: VaultItem[];
  passkeys?: { requestId: string; choices: PasskeyChoice[] };
  iconsBase?: string;
}

type Row =
  | { kind: "passkey"; key: string; choice: PasskeyChoice; requestId: string }
  | { kind: "login"; key: string; item: VaultItem };

const MAX_RESULTS = 50;

/** Proof (to the service worker) that our content script opened this menu. */
const nonce = location.hash.slice(1);

/** The menu's narrow channel: the service worker scopes every request to this frame's tab. */
function send<T>(request: object): Promise<T> {
  return chrome.runtime.sendMessage({ ...request, nonce }) as Promise<T>;
}

function Menu() {
  const [data, setData] = useState<Items>();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState<string>();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void send<Items | undefined>({ inlineMenu: "items" }).then((d) => d && setData(d));
  }, []);

  const rows = useMemo<Row[]>(() => {
    if (!data || data.locked) {
      return [];
    }
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length > 0) {
      return data.all
        .filter((i) =>
          terms.every((term) =>
            `${i.name} ${i.subtitle} ${i.uris.join(" ")}`.toLowerCase().includes(term),
          ),
        )
        .slice(0, MAX_RESULTS)
        .map((item) => ({ kind: "login", key: `l:${item.id}`, item }));
    }
    const passkeys: Row[] = (data.passkeys?.choices ?? []).map((choice) => ({
      kind: "passkey",
      key: `p:${choice.cipherId}`,
      choice,
      requestId: data.passkeys!.requestId,
    }));
    return [
      ...passkeys,
      ...data.matches.map((item): Row => ({ kind: "login", key: `l:${item.id}`, item })),
    ];
  }, [data, query]);

  useEffect(() => setSelected(0), [query]);

  // Tell the content script how tall we really are, so the frame fits its content.
  useLayoutEffect(() => {
    const height = root.current?.getBoundingClientRect().height;
    if (height) {
      void send({ inlineMenu: "resize", height: Math.ceil(height) });
    }
  }, [data, rows.length]);

  useEffect(() => {
    root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  async function activate(row: Row) {
    if (busy) {
      return;
    }
    if (row.kind === "passkey") {
      setBusy(row.key);
      await send({
        inlineMenu: "passkey",
        requestId: row.requestId,
        cipherId: row.choice.cipherId,
      });
      return;
    }
    if (row.item.reprompt) {
      await send({ inlineMenu: "openPopup" });
      return;
    }
    setBusy(row.key);
    await send({ inlineMenu: "fill", id: row.item.id });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) =>
        Math.max(0, Math.min(rows.length - 1, s + (e.key === "ArrowDown" ? 1 : -1))),
      );
    } else if (e.key === "Enter" && rows[selected]) {
      e.preventDefault();
      void activate(rows[selected]);
    } else if (e.key === "Escape") {
      void send({ inlineMenu: "close" });
    }
  }

  const passkeyCount = query === "" ? (data?.passkeys?.choices.length ?? 0) : 0;

  return (
    <IconsContext.Provider value={data?.iconsBase}>
      <div ref={root} onKeyDown={onKeyDown}>
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
        {data && !data.locked && (
          <>
            <div class="search inline-search">
              <Icon name="search" size={14} />
              <input
                class="input"
                type="search"
                spellcheck={false}
                placeholder={t("searchVault")}
                aria-label={t("searchVault")}
                value={query}
                onInput={(e) => setQuery(e.currentTarget.value)}
              />
            </div>
            <div class="inline-list" role="listbox">
              {rows.length === 0 && (
                <div class="inline-hint">
                  {query === "" ? t("noLoginsForSite") : t("noItemsFound")}
                </div>
              )}
              {rows.map((row, index) => {
                const first = index === 0 || rows[index - 1].kind !== row.kind;
                return (
                  <div key={row.key}>
                    {first && query === "" && (
                      <div class="section">
                        <span class="label">
                          {row.kind === "passkey" ? t("passkeys") : t("thisSite")}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      class="item"
                      role="option"
                      aria-selected={index === selected}
                      disabled={busy !== undefined}
                      onMouseMove={() => index !== selected && setSelected(index)}
                      onClick={() => void activate(row)}
                    >
                      {row.kind === "passkey" ? (
                        <>
                          <span class="tile c0">
                            <Icon name="key" size={15} />
                          </span>
                          <span class="item-text">
                            <span class="item-name">{row.choice.userName || row.choice.name}</span>
                            <span class="item-sub">
                              {passkeySubtitle(row.choice, data?.passkeys?.choices ?? [])}
                            </span>
                          </span>
                          <span class="badge">{t("passkey")}</span>
                        </>
                      ) : (
                        <>
                          <Tile item={row.item} />
                          <span class="item-text">
                            <span class="item-name">{row.item.name}</span>
                            <span class="item-sub">{row.item.subtitle || row.item.uris[0]}</span>
                          </span>
                          {row.item.reprompt && <Icon name="lock" size={14} />}
                        </>
                      )}
                      {busy === row.key && <Spinner />}
                    </button>
                  </div>
                );
              })}
            </div>
            {passkeyCount > 0 && <div class="inline-foot label">{t("passkeyHint")}</div>}
          </>
        )}
      </div>
    </IconsContext.Provider>
  );
}

render(<Menu />, document.getElementById("app")!);
