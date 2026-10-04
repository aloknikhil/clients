import { Component, render, type ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import {
  AuthStatus,
  call,
  type LoginResult,
  type Status,
  type TwoFactorProvider,
} from "../lib/rpc";

import { tOr } from "../lib/i18n";

import { urlsFor } from "../lib/env";

import { Icon, IconsContext, Mark, Spinner, ToastProvider } from "./components";
import { CipherType, Edit, NewItem } from "./views/Edit";
import { Generator } from "./views/Generator";
import { Item } from "./views/Item";
import { Lock } from "./views/Lock";
import { Login } from "./views/Login";
import { NewDevice } from "./views/NewDevice";
import { Settings } from "./views/Settings";
import { Trash } from "./views/Trash";
import { TwoFactor } from "./views/TwoFactor";
import { Vault } from "./views/Vault";

type Screen =
  | { name: "vault" }
  | { name: "item"; id: string; from: "vault" | "trash" }
  | { name: "new" }
  | { name: "edit"; id?: string; type?: CipherTypeValue }
  | { name: "generator" }
  | { name: "settings" }
  | { name: "trash" };

type CipherTypeValue = (typeof CipherType)[keyof typeof CipherType];

type LoginStep =
  | { step: "credentials" }
  | { step: "twoFactor"; providers: TwoFactorProvider[] }
  | { step: "newDevice" };

function App() {
  const [status, setStatus] = useState<Status>();
  const [loginStep, setLoginStep] = useState<LoginStep>({ step: "credentials" });
  const [screen, setScreen] = useState<Screen>({ name: "vault" });
  const [iconsBase, setIconsBase] = useState<string>();

  // Favicons come from the user's own server; resolved once per unlock.
  const unlocked = status?.status === AuthStatus.Unlocked;
  useEffect(() => {
    if (!unlocked) {
      return;
    }
    void Promise.all([call("getEnvironment"), call("getSettings")]).then(([env, settings]) =>
      setIconsBase(settings.showIcons ? urlsFor(env).icons : undefined),
    );
  }, [unlocked, screen.name === "vault"]);

  const refresh = () => {
    setScreen({ name: "vault" });
    void call("status").then(setStatus);
  };
  useEffect(refresh, []);

  function onLoginResult(result: LoginResult) {
    if (result.kind === "twoFactor") {
      setLoginStep({ step: "twoFactor", providers: result.providers });
    } else if (result.kind === "newDeviceVerification") {
      setLoginStep({ step: "newDevice" });
    } else if (result.kind === "success") {
      setLoginStep({ step: "credentials" });
      refresh();
    }
  }

  // `autofocus` is only honored on page load; views mounted later need an explicit focus.
  useEffect(() => {
    const target = document.querySelector<HTMLElement>("[autofocus]");
    if (target && (document.activeElement === document.body || document.activeElement === null)) {
      target.focus();
    }
  });

  if (status !== undefined && status.buildId !== __BUILD_ID__) {
    return (
      <Recover
        title={tOr("extensionUpdated", "Extension updated")}
        detail={tOr(
          "extensionUpdatedDesc",
          "The popup was rebuilt while the old background was still running. Reload the extension from the extensions page to finish updating.",
        )}
        action={tOr("openExtensionsPage", "Open extensions page")}
        // Only reachable in development (store updates swap both halves at once). Reloading from
        // chrome://extensions is deterministic; chrome.runtime.reload() can leave unpacked
        // extensions disabled in some setups.
        onAction={() =>
          void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
        }
      />
    );
  }

  if (status === undefined) {
    return (
      <div class="splash faint">
        <Spinner />
      </div>
    );
  }

  if (status.status === AuthStatus.LoggedOut) {
    const restart = () => setLoginStep({ step: "credentials" });
    switch (loginStep.step) {
      case "twoFactor":
        return (
          <TwoFactor providers={loginStep.providers} onResult={onLoginResult} onCancel={restart} />
        );
      case "newDevice":
        return <NewDevice onResult={onLoginResult} onCancel={restart} />;
      default:
        return <Login onResult={onLoginResult} />;
    }
  }

  if (status.status === AuthStatus.Locked) {
    return <Lock status={status} onUnlocked={refresh} onLoggedOut={refresh} />;
  }

  const home = () => setScreen({ name: "vault" });
  let content;
  switch (screen.name) {
    case "item": {
      const from = screen.from;
      content = (
        <Item
          id={screen.id}
          onBack={() => setScreen(from === "trash" ? { name: "trash" } : { name: "vault" })}
          onEdit={(id) => setScreen({ name: "edit", id })}
        />
      );
      break;
    }
    case "new":
      content = <NewItem onPick={(type) => setScreen({ name: "edit", type })} onCancel={home} />;
      break;
    case "edit": {
      const { id } = screen;
      content = (
        <Edit
          id={id}
          type={screen.type}
          onSaved={(savedId) => setScreen({ name: "item", id: savedId, from: "vault" })}
          onCancel={() => setScreen(id ? { name: "item", id, from: "vault" } : { name: "vault" })}
        />
      );
      break;
    }
    case "generator":
      content = <Generator onBack={home} />;
      break;
    case "settings":
      content = (
        <Settings
          status={status}
          onBack={home}
          onTrash={() => setScreen({ name: "trash" })}
          onLocked={refresh}
          onLoggedOut={refresh}
        />
      );
      break;
    case "trash":
      content = (
        <Trash
          onOpen={(id) => setScreen({ name: "item", id, from: "trash" })}
          onBack={() => setScreen({ name: "settings" })}
        />
      );
      break;
    default:
      content = (
        <Vault
          onOpen={(id) => setScreen({ name: "item", id, from: "vault" })}
          onNavigate={(name) =>
            setScreen(name === "generator" ? { name: "generator" } : { name: "settings" })
          }
          onNew={() => setScreen({ name: "new" })}
          onLock={() => void call("lock").then(refresh)}
        />
      );
  }
  return <IconsContext.Provider value={iconsBase}>{content}</IconsContext.Provider>;
}

/** Full-screen recovery with a single action. */
function Recover({
  title,
  detail,
  action,
  onAction,
}: {
  title: string;
  detail: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div class="view">
      <div class="auth">
        <div class="auth-head">
          <Mark size={36} />
          <h1 class="title">{title}</h1>
          <p class="muted" style={{ margin: 0 }}>
            {detail}
          </p>
        </div>
        <button type="button" class="btn primary block" onClick={onAction}>
          <Icon name="refresh" size={14} />
          {action}
        </button>
      </div>
    </div>
  );
}

/** A render error must never leave a blank popup. The message is an exception string, not vault data. */
class ErrorBoundary extends Component<{ children: ComponentChildren }, { error?: string }> {
  state: { error?: string } = {};

  componentDidCatch(error: unknown) {
    this.setState({ error: error instanceof Error ? error.message : String(error) });
  }

  render() {
    return this.state.error === undefined ? (
      this.props.children
    ) : (
      <Recover
        title={tOr("somethingWentWrong", "Something went wrong")}
        detail={this.state.error}
        action={tOr("tryAgain", "Try again")}
        onAction={() => location.reload()}
      />
    );
  }
}

render(
  <ErrorBoundary>
    <ToastProvider>
      <App />
    </ToastProvider>
  </ErrorBoundary>,
  document.getElementById("app")!,
);
