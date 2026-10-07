# tiny-edit — CLAUDE.md

tiny-edit ("Tiny Edit", bundle id `com.peleusx.tiny-edit`) is a small, fast Electron text editor for Markdown and plain-text files on macOS: a monospace CodeMirror 6 editor that **highlights** Markdown (never hides or reformats it) next to a sidebar listing the files you have opened. Design and data flow live in `docs/architecture.md`; the original brief and decisions log live in `docs/plan.md`. Read both before changing behaviour.

## Session Location Check

- **Before doing anything at all, check whether the session is local or remote.** If local, confirm with the user whether they'd like to continue locally before proceeding. If remote, continue right away without confirming.

## Clarifying Questions

- **Always ask the user clarifying questions before starting work** if any requirement is ambiguous, underspecified, or could reasonably be interpreted multiple ways. Use the `AskUserQuestion` tool to surface choices upfront rather than guessing and reworking later.
- **Ask before code changes, not after.** Any change to editor behaviour, file handling, persistence, keyboard shortcuts, or visible UI gets the options and a recommended default presented first. Small internal refactors and test additions don't need a question.
- When a decision is made, **record it** in `docs/plan.md` §Decisions (one line, dated) and, if it changes the design, in `docs/architecture.md`.

## Product Rules (non-negotiable)

From the brief and Neo's CONTRIBUTING ground rules. They beat convenience and "it's what editors usually do".

1. **Never alter the user's text automatically.** No spellcheck, autocorrect, autocapitalize, smart quotes/dashes, auto-closing brackets, list continuation, whitespace trimming, or line-ending normalisation. Exactly two keyboard conveniences exist and are documented: Tab inserts two spaces, and Enter copies the previous line's leading whitespace. `spellcheck=false autocorrect=off autocapitalize=off` stay on the editor content element and `webPreferences.spellcheck: false` in main. Files are read and written byte-for-byte apart from the user's edits (CRLF stays CRLF, no final newline is added).
2. **Never hide Markdown syntax.** Markers (`#`, `*`, `` ` ``, `[]()`, fences) stay visible. Highlighting may change colour, bold `**strong**`, and italicise `*em*`. Nothing changes size, indentation, or layout.
3. **Words are never lost.** Every write is atomic (temp file in the same directory + rename). Autosave runs 300 ms after the last edit and flushes on file switch, window blur, and quit; quit waits for the flush. Disk changed and buffer clean → reload silently, keep the caret. Disk changed and buffer dirty → keep the local text and show a Reload / Keep mine bar; never silently discard either side. Removing a file from the sidebar never deletes it from disk.
4. **Fast and responsive above all.** Nothing synchronous on the keystroke path except CodeMirror's own update. No sync `fs` in IPC handlers at runtime (startup state load is the one allowed sync read). The window is created hidden with a theme-matched `backgroundColor` and shown on `ready-to-show`. Heavy modules are required lazily. Nothing at startup touches the network. Measure before optimising; don't add caches or workers without a profile showing the need.
5. **Plain files only.** No database. Files stay where the user put them; the app remembers paths and view state in one JSON file.
6. **Offline.** No runtime font downloads, no update checks, no telemetry.

## Architecture Rules

- **Three processes, three TypeScript targets.** `src/main/` (Node), `src/preload/` (sandbox-safe, may only import `electron`), `src/renderer/` (browser, no Node). Source is TypeScript with ESM syntax; electron-vite bundles main and preload to CommonJS (no `"type": "module"` in package.json) because a sandboxed preload must be CJS. Shared types and constants in `src/shared/` (no Node or DOM imports there). Vanilla TypeScript in the renderer; no UI framework.
- **Logic is pure and injectable; wiring is thin.** Modules in `src/main/` take their `fs`/`electron` dependencies as parameters (or import from a one-line adapter) so they unit-test without Electron. `src/main/index.ts` and `src/preload/index.ts` only wire things together and are covered by E2E tests, not unit tests.
- **One IPC contract.** `src/shared/ipc.ts` holds channel constants and the `Api` type. Preload implements `Api` with `contextBridge.exposeInMainWorld('api', …)`; main registers every `ipcMain.handle` in one `registerIpc()` call at startup. Channels are `domain:verb` (`file:read`, `file:write`, `files:add`, `state:get`, `state:patch`, `watch:changed`). Main→renderer pushes use `webContents.send`; the preload exposes `onX(cb)` that strips the event object and **returns an unsubscribe function**. Never expose `ipcRenderer` itself. Adding, renaming, or removing a channel touches `ipc.ts`, preload, the main handler, `docs/architecture.md`, and tests in the same change.
- **Security defaults are mandatory and tested.** The renderer is served from the private `app://renderer/` scheme via `protocol.handle` (never `file://`: with the `GrantFileProtocolExtraPrivileges` fuse off, `file://` pages cannot even load module scripts, which is exactly what broke the first packaged build). `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webPreferences.spellcheck: false`; a CSP `<meta>` in `index.html` (`default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`); `setWindowOpenHandler(() => ({ action: 'deny' }))`; `will-navigate` → `preventDefault`. **Every IPC handler validates its arguments**: paths are strings, absolute, `path.resolve`d, and for read/write/stat they must already be in the known-files list (or, for `files:add`, pass the accept check). `shell.openExternal` only receives `https:`/`http:`/`mailto:` URLs after parsing with `new URL`. Don't copy Neo's unvalidated `path.join(id)` pattern.
- **State is one versioned file**, `userData/state.json`, written atomically, debounced 250 ms, flushed on quit, parsed defensively field by field (a corrupt or hand-edited file must never block launch; it is renamed to `state.json.corrupt-<timestamp>` and defaults are used). Window bounds are validated against `screen.getAllDisplays()` before restore.
- **External change detection** watches each listed file's parent directory with `fs.watch`, debounces 150 ms, compares `mtimeMs`/size to the last write we made, and re-stats all listed files on window focus. Our own writes are suppressed by remembering their resulting `mtimeMs` and size.
- **Theming uses tokens only.** A theme is `{ id, name, builtin, tokens: { colors, syntax, radius, fontFamily } }` (see `docs/architecture.md` §Themes). Tokens become `--te-*` CSS custom properties on `<html>`; **component CSS and the CodeMirror highlight style reference only `var(--te-*)`, never literal colours**. Built-in themes go through the same `parseThemeTokens` as user themes from `userData/themes/*.json`.
- **Renderer modules are small and single-purpose** (`sidebar/`, `editor/`, `theme/`, `store.ts`, `conflict.ts`). No file over ~400 lines; split before it gets there. No globals; ES modules only.
- **Dependencies are few and pinned.** Electron is pinned to an exact version; `@codemirror/*` packages move together. Before adding a dependency, state what it replaces and its size.

## Testing

- **Always add tests for new code.** Every module gets unit tests; every user-facing behaviour gets a Playwright E2E test.
- Layout: `tests/unit/**` (Vitest; `node` environment for `main`/`shared`, `happy-dom` for `renderer`) and `tests/e2e/**` (Playwright `_electron` against `npm run build` output). Test files mirror the source tree: `src/main/files.ts` → `tests/unit/main/files.test.ts`.
- File-system tests use **real temp directories** (`fs.mkdtemp`), not mocks, so atomic writes and watcher behaviour are exercised for real. `electron` is mocked in `tests/unit/setup.ts` via `vi.mock('electron', …)`.
- Commands: `npm test` (unit), `npm run test:e2e`, `npm run test:coverage`, `npm run check` (lint + typecheck + unit coverage + e2e).
- **Coverage gate: 95 % lines**, enforced in `vitest.config.ts`, excluding only `src/main/index.ts`, `src/preload/index.ts`, and `*.d.ts`. Don't lower it; don't add exclusions without asking.
- **Never wrap up with failing tests or a coverage shortfall, even ones that look unrelated.** The final step before declaring a task done is `npm run check`, and every failure is fixed. Pre-existing failures still need triage: fix the test or fix the code.
- **E2E assumes no tiling window manager.** The user runs AeroSpace, which resizes new windows into tiles and parks hidden-workspace windows off-screen (x≈2300). Window-geometry tests fail under it; the user disables AeroSpace before `npm run test:e2e`. If a geometry test fails with absurd bounds, ask whether AeroSpace is on before debugging the app. `scripts/diag-window.mjs` prints displays and window bounds over time for this.
- E2E runs against a build whose `EnableNodeCliInspectArguments` fuse is still on, or Playwright cannot attach. Flip fuses only in `npm run package`. **Because fuses change behaviour, every packaging change must be smoke-tested by the user in the packaged `.app`, not only in E2E.**
- **In E2E never use `locator.fill()` or `insertText`.** They go through CDP `Input.insertText`, which can hang indefinitely in Electron when the window is not frontmost. Focus the element, then `page.keyboard.type(...)` / `press(...)`, which are plain key events and work unfocused. Playwright also records no browser-side trace for Electron contexts, so a hung action leaves only the test-side timeline.
- E2E tests simulate Finder drops through the `files:add` IPC (Playwright can't drive a native drop); the preload's `getPathForFile` wrapper is covered by a unit test.

## Tooling & Commands

- **Claude Code's shell on this Mac runs inside an app-sandbox container that cannot launch GUI or Mach-service processes.** Electron dies with `bootstrap_check_in … Permission denied`, so `npm run dev`, `npm run test:e2e`, and `npm run package` must be run by the user in a normal terminal (suggest `! npm run test:e2e`). Everything else (lint, typecheck, unit tests, build) runs fine inside the sandbox. Never report E2E as passing without the user's output.
- The sandbox also blocks `~/Library/Caches`, so inside it install with `electron_config_cache=$PWD/.tmp/electron-cache npm install` and package with `ELECTRON_BUILDER_CACHE=$PWD/.tmp/electron-builder-cache npx electron-builder --mac -c.electronDownload.cache=$PWD/.tmp/electron-cache` (`.tmp/` is gitignored). Packaging itself works inside the sandbox; only launching the result does not. A normal terminal needs no override. **Always run `npm run build` before invoking electron-builder directly** (or use `npm run package`, which does): electron-builder packs whatever is in `out/`, and a stale `out/` once shipped a fix-less `.app` while E2E was green.
- npm 11 gates install scripts: `package.json` `allowScripts` lists `electron`, `esbuild`, `electron-winstaller` **unpinned** (`"electron": true`). Never pin a version there (Neo's `electron@33` entry silently stopped matching after an upgrade). After adding a dependency with an install script, run `npm approve-scripts <pkg>` and then unpin the entry.

- Node 26 / npm 11 locally. electron-vite for dev/build, electron-builder for packaging (ad-hoc signed `.app`, no notarisation, no auto-update, macOS only).
- `npm run dev` (electron-vite with HMR), `npm run build`, `npm run package`, `npm run install:app` (package + `sudo ditto` into `/Applications`; user runs it) / `install:app:user` (`~/Applications`, no admin), `npm run lint` (ESLint flat config + typescript-eslint), `npm run typecheck` (`tsc -b` over `tsconfig.node.json`, `tsconfig.web.json` and `tsconfig.e2e.json`), `npm run format` (Prettier, check in CI mode with `format:check`).
- `.gitattributes`: `* text=auto`; LF in the repo. `.editorconfig` matches Prettier (2-space, LF, final newline) for source files only; it does not apply to what the app does to user files.

## Documentation Maintenance

- `docs/architecture.md`: purpose, process model, data flow, state-file shape, IPC channels, theme model, fundamental guidelines. **Update it in the same change** whenever any of those change. High level; no line-by-line code docs.
- `docs/plan.md` §Decisions: append one dated line per decision taken with the user.
- `CHANGELOG.md`: one user-facing line per behaviour change, newest first, dated `YYYY-MM-DD`, max 10 entries in the "Unreleased" block before a version is cut.

## Git Workflow

- Default branch `main`; work directly on it. **Commit or push only when the user asks.** Never rewrite history.
- Commit messages: `Area: terse outcome list` (e.g. `Editor: markdown highlight style, fenced-code languages`). End with the attribution line the session provides.

## User Communication

- Drop articles ("the", "a", "an") and filler/hedging words.
- Use sentence fragments; skip pleasantries and preamble.
- Abbreviate common technical terms: database→DB, authentication→auth, configuration→config, repository→repo, function→fn, variable→var.
- Use arrows for logic/flow: `input -> validate -> save -> return`.
- Prefer short synonyms; cut redundant words.
- Keep code blocks, file paths, commands, and identifiers exact and complete; never compress code, only prose.
- These rules are for chat only. UI strings, docs, and comments use normal English.

## Learned from Neo (`/Users/muse/dev/neo`) — copy / don't copy

- **Copy:** `domain:verb` channel names; `webUtils.getPathForFile` for Finder drops; `role`-based menus with custom items relayed to the renderer; `requestSingleInstanceLock` + `second-instance` focus; validating saved window bounds against displays; `getNormalBounds()` and skipping fullscreen/minimised states; per-file save signature so unchanged files are never rewritten; re-checking disk on focus; theme-matched `backgroundColor`; `ApplePressAndHoldEnabled=false` so held keys repeat.
- **Don't copy:** unvalidated path joins in IPC; non-atomic writes; sync `fs` in handlers; undebounced settings writes on every `resize`/`move`; un-awaited saves in `beforeunload`; a single 5,500-line renderer with globals; missing CSP / `will-navigate` / `setWindowOpenHandler`; `allowScripts` pinned to the wrong Electron version; over-broad entitlements; persisting `setUserDefault` side effects without need.
