import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { t } from "../../lib/i18n";
import { call, CopyableField, FillMode, ItemKind, type VaultItem } from "../../lib/rpc";
import { ErrorText, Icon, IconButton, Mark, Tile, useToast } from "../components";

import { SaveSite } from "./SaveSite";
import { Reprompt } from "./Reprompt";

/** Rendering thousands of rows makes the popup sluggish; search narrows past this. */
const MAX_ROWS = 200;
/** Per-device view preference, not vault data. */
const FAVORITES_KEY = "favoritesOnly";

type Section = "suggested" | "favorites" | "all";

interface Row {
  key: string;
  item: VaultItem;
  section: Section;
}

interface SaveOffer {
  item: VaultItem;
  origin: string;
  host: string;
}

function matches(item: VaultItem, terms: string[]): boolean {
  const haystack = `${item.name} ${item.subtitle} ${item.uris.join(" ")}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function Vault({
  onOpen,
  onNavigate,
  onNew,
  onLock,
}: {
  onOpen: (id: string) => void;
  onNavigate: (view: "generator" | "settings") => void;
  onNew: () => void;
  onLock: () => void;
}) {
  const [items, setItems] = useState<VaultItem[]>();
  const [suggested, setSuggested] = useState<VaultItem[]>([]);
  const [tabId, setTabId] = useState<number>();
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(() => {
    try {
      return localStorage.getItem(FAVORITES_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleFavorites = () => {
    const next = !favoritesOnly;
    setFavoritesOnly(next);
    setSelected(0);
    try {
      localStorage.setItem(FAVORITES_KEY, next ? "1" : "0");
    } catch {
      // Remembering the filter is a convenience; ignore storage failures.
    }
  };
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<() => Promise<void>>();
  const [saveOffer, setSaveOffer] = useState<SaveOffer>();
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        // Fill works on any web page; suggestions are just the ones that match it.
        const fillableTab =
          tab?.id !== undefined && /^https?:/.test(tab.url ?? "") ? tab.id : undefined;
        const [all, forTab] = await Promise.all([
          call("listCiphers"),
          fillableTab === undefined ? Promise.resolve([]) : call("ciphersForTab", fillableTab),
        ]);
        setTabId(fillableTab);
        setItems(
          all.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
        );
        setSuggested(forTab);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const rows = useMemo<Row[]>(() => {
    const all = items ?? [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (favoritesOnly) {
      return all
        .filter((i) => i.favorite && matches(i, terms))
        .map((item) => ({ key: `f:${item.id}`, item, section: "favorites" as const }));
    }
    if (terms.length > 0) {
      return all
        .filter((i) => matches(i, terms))
        .map((item) => ({ key: `a:${item.id}`, item, section: "all" }));
    }
    return [
      ...suggested.map((item) => ({ key: `s:${item.id}`, item, section: "suggested" as const })),
      ...all
        .filter((i) => i.favorite)
        .map((item) => ({ key: `f:${item.id}`, item, section: "favorites" as const })),
      ...all.map((item) => ({ key: `a:${item.id}`, item, section: "all" as const })),
    ];
  }, [items, suggested, query, favoritesOnly]);

  const visible = rows.slice(0, MAX_ROWS + suggested.length);
  const allCount = query === "" ? (items?.length ?? 0) : rows.length;
  const canFill = (item: VaultItem) => tabId !== undefined && item.kind === ItemKind.Login;

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const report = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  function guarded(item: VaultItem, run: () => Promise<void>) {
    const wrapped = () => run().catch(report);
    if (item.reprompt) {
      setPending(() => wrapped);
    } else {
      void wrapped();
    }
  }

  function copy(item: VaultItem, field: CopyableField) {
    const label = { username: t("username"), password: t("password"), totp: t("oneTimeCode") }[
      field
    ];
    const run = async () => {
      if (await call("copyField", item.id, field)) {
        toast(t("valueCopied", label));
      }
    };
    // Usernames aren't protected by reprompt in the reference client either.
    if (field === CopyableField.Username) {
      void run();
    } else {
      guarded(item, run);
    }
  }

  /** Explicit fill: works on any page. If the page isn't one of the item's sites, offer to save it. */
  function fill(item: VaultItem) {
    guarded(item, async () => {
      const result = await call("autofill", tabId!, item.id, FillMode.Explicit);
      if (result.kind === "nothingToFill") {
        toast(t("autofillFailed"));
        return;
      }
      if (result.totpCopied) {
        toast(t("codeCopiedForNextStep"));
      }
      if (result.unmatched?.canSave) {
        setSaveOffer({ item, origin: result.unmatched.origin, host: result.unmatched.host });
      } else {
        setTimeout(() => window.close(), result.totpCopied ? 900 : 0);
      }
    });
  }

  function open(item: VaultItem) {
    guarded(item, async () => onOpen(item.id));
  }

  function onKeyDown(e: KeyboardEvent) {
    const row = visible[selected];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setSelected((s) => Math.max(0, Math.min(visible.length - 1, s + delta)));
    } else if (e.key === "Enter" && row) {
      e.preventDefault();
      if (canFill(row.item)) {
        fill(row.item);
      } else {
        open(row.item);
      }
    } else if (
      e.key === "ArrowRight" &&
      row &&
      (query === "" || search.current?.selectionStart === query.length)
    ) {
      e.preventDefault();
      open(row.item);
    } else if (e.key === "Escape" && query !== "") {
      e.preventDefault();
      setQuery("");
    } else if (e.key === "/" && document.activeElement !== search.current) {
      e.preventDefault();
      search.current?.focus();
    }
  }

  if (pending) {
    return (
      <Reprompt
        onCancel={() => setPending(undefined)}
        onVerified={() => {
          const run = pending;
          setPending(undefined);
          void run();
        }}
      />
    );
  }

  if (saveOffer) {
    return (
      <SaveSite
        item={saveOffer.item}
        host={saveOffer.host}
        onDismiss={() => window.close()}
        onSave={async () => {
          await call("addSiteToItem", saveOffer.item.id, saveOffer.origin);
          toast(t("siteSaved"));
          setTimeout(() => window.close(), 700);
        }}
      />
    );
  }

  const sectionTitle: Record<Section, string> = {
    suggested: t("thisPage"),
    favorites: t("favorites"),
    all: query === "" ? t("allItems") : t("results"),
  };
  const selectedRow = visible[selected];

  return (
    <div class="view" onKeyDown={onKeyDown}>
      <header class="topbar">
        <Mark size={22} />
        <div class="search">
          <Icon name="search" size={15} />
          <input
            ref={search}
            class="input"
            type="search"
            autoFocus
            spellcheck={false}
            placeholder={t("searchVault")}
            aria-label={t("searchVault")}
            aria-controls="vault-list"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          {query === "" && <kbd>/</kbd>}
        </div>
        <IconButton icon="plus" label={t("newItem")} onClick={onNew} />
        <IconButton icon="wand" label={t("generator")} onClick={() => onNavigate("generator")} />
        <IconButton icon="settings" label={t("settings")} onClick={() => onNavigate("settings")} />
        <IconButton
          icon="star"
          label={favoritesOnly ? t("showAllItems") : t("showFavorites")}
          active={favoritesOnly}
          filled={favoritesOnly}
          onClick={toggleFavorites}
        />
        <IconButton icon="lock" label={t("lockNow")} onClick={onLock} />
      </header>

      <div class="scroll" ref={list} id="vault-list" role="listbox" aria-label={t("searchVault")}>
        <ErrorText error={error} />
        {items === undefined && !error && <div class="empty">{t("loading")}</div>}
        {items !== undefined && visible.length === 0 && (
          <div class="empty">
            <Icon name="search" size={18} />
            {query === "" ? t("vaultEmpty") : t("noItemsFound")}
            {query === "" && (
              <button type="button" class="btn" style={{ marginTop: "8px" }} onClick={onNew}>
                <Icon name="plus" size={15} />
                {t("newItem")}
              </button>
            )}
          </div>
        )}
        {visible.map((row, index) => {
          const first = index === 0 || visible[index - 1].section !== row.section;
          const { item } = row;
          return (
            <div key={row.key}>
              {first && (
                <div class="section">
                  <span class="label">{sectionTitle[row.section]}</span>
                  {row.section === "all" && <span class="label">{allCount}</span>}
                </div>
              )}
              <div
                class="item"
                role="option"
                tabIndex={-1}
                aria-selected={index === selected}
                onMouseMove={() => index !== selected && setSelected(index)}
                onClick={() => open(item)}
              >
                <Tile item={item} />
                <span class="item-text">
                  <span class="item-name">
                    {item.name}
                    {item.favorite && row.section !== "favorites" && (
                      <span class="fav" title={t("favorite")} />
                    )}
                  </span>
                  {(item.subtitle || item.uris[0]) && (
                    <span class="item-sub">{item.subtitle || item.uris[0]}</span>
                  )}
                </span>
                <span class="item-actions">
                  {item.hasUsername && (
                    <IconButton
                      icon="user"
                      label={t("copyUsername")}
                      onClick={() => copy(item, CopyableField.Username)}
                    />
                  )}
                  {item.hasPassword && item.viewPassword && (
                    <IconButton
                      icon="key"
                      label={t("copyPassword")}
                      onClick={() => copy(item, CopyableField.Password)}
                    />
                  )}
                  {item.hasTotp && (
                    <IconButton
                      icon="clock"
                      label={t("copyOneTimeCode")}
                      onClick={() => copy(item, CopyableField.Totp)}
                    />
                  )}
                </span>
                {canFill(item) && (
                  <button
                    type="button"
                    class={row.section === "suggested" ? "fill-btn match" : "fill-btn"}
                    onClick={(e) => {
                      e.stopPropagation();
                      fill(item);
                    }}
                  >
                    {t("fill")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {rows.length > visible.length && (
          <div class="empty">{t("refineSearch", String(MAX_ROWS))}</div>
        )}
      </div>

      <footer class="statusbar">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd>
        </span>
        <span>
          <kbd>↵</kbd>{" "}
          {selectedRow && canFill(selectedRow.item) ? t("fill").toLowerCase() : t("open")}
        </span>
        {selectedRow && canFill(selectedRow.item) && (
          <span>
            <kbd>→</kbd> {t("open")}
          </span>
        )}
        <span class="spacer" />
        <span>{items === undefined ? "" : t("itemCount", String(items.length))}</span>
      </footer>
    </div>
  );
}
