import { isAbsolute, resolve } from "node:path";

/**
 * File paths handed to the app on the command line. macOS delivers Finder double-clicks and Dock
 * drops through the `open-file` event (never argv), so this covers the other routes: `tiny-edit
 * file`, `open --args`, launching the bundle's binary directly, and the argv a second launch
 * relays via `second-instance`.
 *
 * Electron/Chromium switches are dropped: anything starting with `-` (including macOS's
 * `-psn_0_123` process-serial argument), plus a lone `--` separator — everything after which is
 * treated as a positional path even if it starts with `-`. Remaining args are resolved to
 * absolute paths against `cwd`; `accept()` still vets each one before it reaches the sidebar.
 *
 * `packaged` mirrors `app.isPackaged`: a packaged bundle's argv is `[exec, ...args]`, while a
 * dev/E2E launch (`electron .`) inserts the app path at index 1, so that slot is skipped too.
 */
export function fileArgsFrom(argv: readonly string[], cwd: string, packaged: boolean): string[] {
  const rest = argv.slice(packaged ? 1 : 2);
  const out: string[] = [];
  let positionalOnly = false;
  for (const arg of rest) {
    if (!positionalOnly && arg === "--") {
      positionalOnly = true;
      continue;
    }
    if (arg === "" || (!positionalOnly && arg.startsWith("-"))) continue;
    out.push(isAbsolute(arg) ? arg : resolve(cwd, arg));
  }
  return out;
}
