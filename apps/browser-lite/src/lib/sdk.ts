import * as sdk from "@bitwarden/sdk-internal";
import wasmUrl from "@bitwarden/sdk-internal/bitwarden_wasm_internal_bg.wasm?url";

export * from "@bitwarden/sdk-internal";

/** `index.js` (the package's `module` entry) exposes `init` but the typings don't declare it. */
interface SdkGlue {
  init(exports: WebAssembly.Exports): void;
}

let ready: Promise<void> | undefined;

/**
 * Streams and instantiates the SDK wasm exactly once per JS context.
 *
 * The package is a wasm-bindgen "bundler" build: the wasm imports its glue from
 * `./bitwarden_wasm_internal_bg.js`, which the package entry re-exports in full. We hand that
 * namespace in as the import object, then point the glue back at the instance's exports.
 */
export function loadSdk(): Promise<void> {
  ready ??= (async () => {
    const imports = { "./bitwarden_wasm_internal_bg.js": sdk } as unknown as WebAssembly.Imports;
    const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl), imports);
    (sdk as unknown as SdkGlue).init(instance.exports);
    (instance.exports as { __wbindgen_start?: () => void }).__wbindgen_start?.();
    // Required before any other SDK call: installs the panic hook (readable panics instead of
    // `unreachable`) and logging. The flight recorder is a debugging aid we don't expose.
    sdk.init_sdk(sdk.LogLevel.Warn, sdk.LogLevel.Warn, 0);
  })();
  ready.catch(() => (ready = undefined));
  return ready;
}
