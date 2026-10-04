import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useState } from "preact/hooks";

import {
  ArrowRight,
  Check,
  ChevronLeft,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
  FolderPlus,
  Globe,
  IdCard,
  KeyRound,
  Lock,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanQrCode,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
  Star,
  StickyNote,
  Trash,
  TriangleAlert,
  User,
  WandSparkles,
  X,
} from "lucide-preact";

import { t } from "../lib/i18n";
import { ItemKind, type VaultItem } from "../lib/rpc";

const ICONS = {
  search: Search,
  back: ChevronLeft,
  lock: Lock,
  settings: SlidersHorizontal,
  wand: WandSparkles,
  copy: Copy,
  eye: Eye,
  eyeOff: EyeOff,
  check: Check,
  user: User,
  key: KeyRound,
  clock: Clock,
  external: ExternalLink,
  refresh: RefreshCw,
  note: StickyNote,
  card: CreditCard,
  person: IdCard,
  terminal: SquareTerminal,
  logout: LogOut,
  arrow: ArrowRight,
  plus: Plus,
  pencil: Pencil,
  trash: Trash,
  star: Star,
  restore: RotateCcw,
  close: X,
  scan: ScanQrCode,
  globe: Globe,
  folderPlus: FolderPlus,
  shield: ShieldCheck,
  warning: TriangleAlert,
} as const;

export type IconName = keyof typeof ICONS;

/**
 * Lucide icons (24px grid). The stroke is scaled so it lands on 1.5 device pixels at 16px,
 * which keeps edges crisp on 1x displays instead of smearing across pixel boundaries.
 */
export function Icon({
  name,
  size = 16,
  filled = false,
}: {
  name: IconName;
  size?: number;
  filled?: boolean;
}) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      size={size}
      strokeWidth={(1.5 * 24) / size}
      fill={filled ? "currentColor" : "none"}
      aria-hidden="true"
      class="icon"
    />
  );
}

/** Vault-dial mark: notched ring with an accent core. Matches the toolbar icon. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg class="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="8"
        fill="#0b0e12"
        stroke="#303235"
        stroke-width="1.5"
      />
      <circle cx="32" cy="32" r="16.2" fill="none" stroke="#dedede" stroke-width="4.8" />
      <rect x="30" y="12" width="4" height="9" fill="#0b0e12" />
      <rect x="26.5" y="26.5" width="11" height="11" rx="1.5" fill="#00d892" />
    </svg>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  active = false,
  filled = false,
}: {
  icon: IconName;
  label: string;
  onClick: (e: MouseEvent) => void;
  active?: boolean;
  filled?: boolean;
}) {
  return (
    <button
      type="button"
      class={active ? "icon-btn active" : "icon-btn"}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      <Icon name={icon} filled={filled} />
    </button>
  );
}

export function Topbar({
  title,
  onBack,
  children,
}: {
  title?: string;
  onBack?: () => void;
  children?: ComponentChildren;
}) {
  return (
    <header class="topbar">
      {onBack && <IconButton icon="back" label={t("back")} onClick={onBack} />}
      {title !== undefined && <h1>{title}</h1>}
      {children}
    </header>
  );
}

export function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      class="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      {checked && <Icon name="check" size={12} />}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div class="segmented" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const KIND_ICON: Partial<Record<VaultItem["kind"], IconName>> = {
  [ItemKind.Note]: "note",
  [ItemKind.Card]: "card",
  [ItemKind.Identity]: "person",
  [ItemKind.SshKey]: "terminal",
};

/** Base URL of the server's icon service, or undefined when website icons are turned off. */
export const IconsContext = createContext<string | undefined>(undefined);

const TILE_COLORS = 8;

/** Stable per-name color, so an item keeps its color across sessions. */
function colorIndex(name: string): number {
  let hash = 0;
  for (const ch of name.toLowerCase()) {
    hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % TILE_COLORS;
}

function hostOf(uri: string | undefined): string | undefined {
  if (!uri) {
    return undefined;
  }
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(uri) ? uri : `https://${uri}`);
    return /^https?:$/.test(url.protocol) && url.hostname.includes(".") ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}

/**
 * How a favicon sits in its tile. `full`: it has its own opaque background (app-icon style), so it
 * fills the tile edge to edge. Otherwise its luminance decides whether it needs a contrasting chip.
 */
type Tone = "full" | "dark" | "light" | "mid";

interface Favicon {
  src: string;
  tone: Tone;
}

const favicons = new Map<string, Promise<Favicon | undefined>>();

/**
 * Fetches a favicon once per popup and measures the average luminance of its opaque pixels.
 * The extension's host permissions let it fetch the icon directly, and a blob URL keeps the
 * canvas untainted. Fails closed: any error falls back to the monogram tile.
 */
function loadFavicon(url: string): Promise<Favicon | undefined> {
  let pending = favicons.get(url);
  if (pending === undefined) {
    pending = (async () => {
      const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
        return undefined;
      }
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(16, 16);
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0, 16, 16);
      bitmap.close();
      const { data } = context.getImageData(0, 0, 16, 16);
      let sum = 0;
      let count = 0;
      let solid = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 240) {
          solid++;
        }
        if (data[i + 3] > 128) {
          sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
          count++;
        }
      }
      if (count === 0) {
        return undefined;
      }
      const luminance = sum / count;
      const tone: Tone =
        solid / (data.length / 4) > 0.9
          ? "full"
          : luminance < 0.22
            ? "dark"
            : luminance > 0.86
              ? "light"
              : "mid";
      return { src: URL.createObjectURL(blob), tone };
    })().catch(() => undefined);
    favicons.set(url, pending);
  }
  return pending;
}

export function Tile({
  item,
  large = false,
}: {
  item: Pick<VaultItem, "kind" | "name"> & { uris?: string[] };
  large?: boolean;
}) {
  const icons = useContext(IconsContext);
  const host = item.kind === ItemKind.Login ? item.uris?.map(hostOf).find(Boolean) : undefined;
  const url = icons && host ? `${icons}/${host}/icon.png` : undefined;
  const [favicon, setFavicon] = useState<Favicon>();
  const size = large ? "lg" : "";

  useEffect(() => {
    let current = true;
    setFavicon(undefined);
    if (url) {
      void loadFavicon(url).then((f) => current && setFavicon(f));
    }
    return () => {
      current = false;
    };
  }, [url]);

  if (favicon) {
    return (
      <span class={`tile favicon tone-${favicon.tone} ${size}`} aria-hidden="true">
        <img src={favicon.src} alt="" decoding="async" />
      </span>
    );
  }
  const kindIcon = KIND_ICON[item.kind];
  return (
    <span class={`tile c${colorIndex(item.name)} ${size}`} aria-hidden="true">
      {kindIcon ? (
        <Icon name={kindIcon} size={large ? 20 : 15} />
      ) : (
        item.name.trim().charAt(0) || "·"
      )}
    </span>
  );
}

/** Colors digits and symbols so passwords are easy to read back, like 1Password. */
export function Secret({ value }: { value: string }) {
  return (
    <>
      {Array.from(value).map((ch, i) => (
        <span
          key={i}
          class={/\d/.test(ch) ? "ch-digit" : /[^\p{L}\p{N}\s]/u.test(ch) ? "ch-symbol" : undefined}
        >
          {ch}
        </span>
      ))}
    </>
  );
}

const ToastContext = createContext<(message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [message, setMessage] = useState<{ text: string; id: number }>();
  useEffect(() => {
    if (message === undefined) {
      return;
    }
    const timer = setTimeout(() => setMessage(undefined), 1600);
    return () => clearTimeout(timer);
  }, [message]);
  const show = useCallback((text: string) => setMessage({ text, id: Date.now() }), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div class="toast" role="status" key={message.id}>
          <Icon name="check" size={14} />
          {message.text}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}

/** Runs an async action with busy/error state, for forms and buttons. */
export function useAction<A extends unknown[]>(action: (...args: A) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = useCallback(
    async (...args: A) => {
      setBusy(true);
      setError(undefined);
      try {
        await action(...args);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [action],
  );
  return { run, busy, error, setError };
}

export function ErrorText({ error }: { error?: string }) {
  return error ? (
    <p class="error" role="alert">
      {error}
    </p>
  ) : null;
}

export function Spinner() {
  return (
    <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        stroke-opacity="0.25"
        stroke-width="2.5"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
      />
    </svg>
  );
}
