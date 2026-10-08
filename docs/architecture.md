# tiny-edit — Architecture

Last updated 2026-10-08 (matches the code after build step 10, plus welcome / What's New pages).

## Purpose

A macOS Electron app for editing Markdown and plain-text files quickly. One window: a resizable sidebar listing the files you have opened (extension stripped) and a monospace CodeMirror 6 editor that colours Markdown and fenced code without ever hiding or reformatting it. Autosaves, remembers everything, reloads when another program changes the file.

## Fundamental guidelines

1. **The text is sacred.** The app never inserts, removes, or substitutes characters on its own. Reads and writes are byte-faithful apart from the user's edits. Only two keyboard conveniences exist: Tab → two spaces, Enter → copies previous line's leading whitespace.
2. **Highlight, don't format.** Colour, bold for strong, italic for emphasis. Same monospace size everywhere; markers visible.
3. **Never lose words.** Atomic writes, flush before quit, conflicts surface a choice instead of picking a side.
4. **Instant.** Hidden window + `ready-to-show`; one state read at startup; viewport-rendered editor; async IPC; nothing on the keystroke path but the editor.
5. **Plain files, one state file, offline.** No DB, no network, no font downloads, no updater.
6. **Secure by default.** Sandboxed renderer, isolated preload, CSP, denied navigation and popups, validated IPC arguments, allow-listed external URLs.
7. **Testable by construction.** Pure modules with injected `fs`/`electron`; wiring files are thin; coverage gate 95 % lines.
8. **Tokens, not colours.** Every colour in CSS or the editor highlight style is a `--te-*` variable set from a theme.

## Process model

```
┌─ main (Node, CJS bundle) ────────────────────────────────────────────┐
│ index.ts        wiring: app lifecycle, single-instance, open-file│
│ window.ts       BrowserWindow factory (hiddenInset, bg colour)   │
│ windowState.ts  bounds save/restore, display validation, debounce│
│ state.ts        state.json load/parse/save (versioned, atomic)   │
│ files.ts        read/write (atomic), stat, accept check, new file│
│ watcher.ts      per-dir fs.watch, debounce, self-write suppress  │
│ themes.ts       built-ins + userData/themes/*.json loader/watcher│
│ menu.ts         app menu (roles + relayed custom items)          │
│ ipc.ts          registerIpc(): every channel + arg validation    │
└──────────────┬──────────── webContents.send / ipcMain.handle ────┘
               │
┌─ preload (CJS, sandboxed) ─────────────────────────────────────┐
│ index.ts  contextBridge.exposeInMainWorld('api', Api)           │
│           getPathForFile(File) via webUtils                     │
└──────────────┬─────────────────────────────────────────────────┘
               │ window.api (typed by src/shared/ipc.ts)
┌─ renderer (browser, vanilla TS) ───────────────────────────────┐
│ main.ts         bootstrap: state -> theme -> sidebar -> editor  │
│ store.ts        in-memory view state, patches -> state:patch    │
│ sidebar/        list, selection, drag reorder, drop, context,  │
│                 per-file outline chevron + flattened H1/H2 TOC  │
│ editor/         CM6 setup, markdown + fenced langs, highlight   │
│                 style -> CSS vars, autosave scheduler, undo map,│
│                 scope.ts (narrow to a section, hide the rest)   │
│ conflict.ts     "Changed on disk · Reload / Keep mine" bar      │
│ theme/          tokens -> --te-* on <html>, Auto (light/dark)   │
└────────────────────────────────────────────────────────────────┘
shared/  ipc.ts (channels + Api type) · types.ts · themes.ts (tokens, parser, built-ins) · text.ts (line-ending detect, UTF-8 sniff) · toc.ts (H1/H2 outline parse)
```

## Data flow

**Launch.** `protocol.registerSchemesAsPrivileged` for `app://` (before ready) → `app.ready` → `protocol.handle("app", …)` serves `out/renderer/**` at `app://renderer/<path>` (traversal-safe, mime by extension) → `state.load()` (sync, once) → `createWindow()` hidden, `backgroundColor` = resolved theme surface, bounds from validated state or centred 950×500 → `registerIpc()` → renderer boots → `state:get` → applies theme, renders sidebar, reads active file (`file:read`), restores cursor/selection/scroll → `ready-to-show` → `win.show()`. `open-file` events (Finder double-click, Dock drop) are queued in `OpenQueue` from before `ready` and drained through `openPaths` once the window exists. The window title and proxy icon (`setRepresentedFilename`) follow `activePath`.

**Typing.** CM6 update → mark buffer dirty, record `docChanged` → 300 ms idle timer → `file:write { path, text, eol }` → main writes `path + '.tmp-<pid>'` then `rename` → records `{ mtimeMs, size }` as our own write → returns → renderer marks clean. Immediate flush on: switching files, `window.blur`, `visibilitychange: hidden`, and window close (`guardClose` intercepts the first `close`, sends `renderer:flush`, waits for `renderer:flushed` ≤ 2 s, flushes `state.json`, then destroys the window; Cmd+Q and the red button both go through this). Renderer `Autosave` keeps one write in flight per file, re-queues edits made meanwhile, and parks a file after a conflict until Reload / Keep mine (`force`). A failed write keeps the buffer dirty and shows a Retry notice.

**External change.** `Watcher` sees an event for a listed path → 150 ms debounce → `stat` → differs from the stamp the renderer holds → `watch:changed { path, stamp }` → renderer: not loaded yet → ignore (the next open reads fresh); clean (active or background) → `file:read` + `replaceText` keeping caret and scroll (clamped); dirty → `autosave.park` + conflict bar (immediately if active, otherwise when it becomes active). Window `focus` → `checkAll()` re-stats every listed file → same path. File gone → `watch:missing` → entry dimmed, notice when active, buffer kept, next autosave recreates the file.

**Adding files.** Sidebar `drop` → preload `getPathForFile` per `File` → `files:add [paths]` → main: absolute, exists, regular file (folders → direct children), accepted (`.md .markdown .txt .text` or first 8 KB decodes as UTF-8 with no NUL) → appended to `state.files`, duplicates ignored → renderer selects the first new file. Same path for `open-file` (Finder double-click / Dock drop) and File → Open… (`dialog.showOpenDialog`). `Cmd+N` → prompt for name in-app → `file:create { dir, name }` next to the active file (Documents if none) → added and selected.

**Sidebar actions.** Click → switch (flush current, load next, restore per-file view state). Drag → reorder (`state:patch { files }`). Right-click → native context menu: Remove from list (also `Cmd+W` for the active file), Reveal in Finder, Copy path. `Cmd+N` → inline name input at the bottom of the list (Enter creates `name.md` next to the active file, or in Documents when the list is empty; Esc cancels; errors inline). Drops are accepted anywhere in the window (`installDropzone`): the sidebar highlights, paths go through `files:add`, the text is never touched. Reordering is HTML5 drag with the private MIME `application/x-tiny-edit-path` so it can never be confused with a Finder drop (`reorder()` is pure). The divider (`installDivider`) previews the width live and commits once on release (120–600 px); `Cmd+\` toggles `sidebarVisible`; `Cmd+=`/`-`/`0` zoom `fontSize` 8–48.

**Outline (table of contents).** `shared/toc.ts` `parseToc(text)` returns the `# `/`## ` headings (exactly one or two `#` then a space; `###`+ ignored; `#` inside fenced code ignored) in document order with each heading's section range `[from, to)` — an H1 runs to the next H1 (so it includes its H2s), an H2 to the next heading of either level. `hasOutline` is true when a file has ≥2 H1s or ≥2 H2s; only then does the sidebar show a right-aligned chevron next to the file name. Clicking the chevron expands a flattened list (H2s indented under their H1) below the name. The outline is computed from the in-memory buffer of loaded files — opening a file (and a 200 ms-debounced recompute while typing) refreshes it; a never-opened file has no chevron until first opened. Clicking a heading opens the file if needed and **narrows** the editor to that section; clicking an H1 shows the whole H1 section (with its H2s), clicking an H2 shows only that subsection; clicking the file name shows the whole file again. Narrowing is renderer-only — no IPC, no change to the file on disk.

Narrowing is `editor/scope.ts`: a `StateField<{from,to}|null>` set by a `setScope` effect and mapped through edits (`from` biases left, `to` right, so text typed at a boundary stays inside; the scope clears if the section is deleted). It hides `[0,from)` and `[to,len)` with replace decorations, marks them atomic so the caret can't enter, and a `changeFilter` protects them so edits can only touch the visible section. The full document always stays in the buffer, so autosave still writes the whole file atomically. An external reload rebuilds the state and drops the scope.

**Links.** Markdown links (`[text](url)`) and autolinks (`<url>`) whose destination is an `http(s)`/`mailto` URL get a hover-revealed open-link button (`links.ts`, a `ViewPlugin` that mirrors the copy buttons: a floating icon on a zero-size anchor after the construct, revealed on line hover) and are openable with `Cmd+click` anywhere on the construct. Either path calls `api.openExternal` → `shell:openExternal` → main parses with `new URL` and allows only `https:`, `http:`, `mailto:` (anything else rejects). Bare URLs in plain text are not recognised (the grammar is CommonMark, no GFM autolink). Relative/fragment destinations get no button and no Cmd+click. SVG icon helpers are shared by both plugins in `editor/svg.ts`.

## State file — `~/Library/Application Support/tiny-edit/state.json`

```json
{
  "version": 1,
  "window": { "x": 120, "y": 80, "width": 950, "height": 500 },
  "sidebarWidth": 200,
  "sidebarVisible": true,
  "fontSize": 14,
  "highlight": true,
  "theme": { "mode": "auto", "light": "macos-light", "dark": "macos-dark", "fixed": "macos-light" },
  "activePath": "/Users/muse/notes/todo.md",
  "files": [{ "path": "/Users/muse/notes/todo.md", "anchor": 1234, "head": 1234, "scrollTop": 480 }]
}
```

- Written atomically (`state.json.tmp` + rename), debounced 250 ms, flushed on quit.
- Parsed field by field with defaults; unknown fields dropped; on JSON parse failure the file is renamed `state.json.corrupt-<iso>` and defaults apply.
- `window` is validated against `screen.getAllDisplays()` work areas before use; min size 400×300.
- Per-file state is capped to the files in the list; removing a file removes its state.

## IPC channels (`src/shared/ipc.ts`)

| Channel                               | Direction | Payload → Result                                                                                                                                                |
| ------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state:get`                           | R→M       | → full `State`                                                                                                                                                  |
| `state:patch`                         | R→M       | `Partial<State>` → void (debounced write)                                                                                                                       |
| `file:read`                           | R→M       | `{ path }` → `{ text, eol, mtimeMs, size }`                                                                                                                     |
| `file:write`                          | R→M       | `{ path, text, eol }` → `{ mtimeMs, size }`                                                                                                                     |
| `file:create`                         | R→M       | `{ dir, name }` → `{ path }`                                                                                                                                    |
| `files:add`                           | R→M       | `{ paths }` → `{ added: string[], rejected: {path, reason}[] }`                                                                                                 |
| `files:reveal` / `files:copyPath`     | R→M       | `{ path }` → void                                                                                                                                               |
| `clipboard:write`                     | R→M       | `text` → void (editor copy buttons; any string)                                                                                                                 |
| `shell:openExternal`                  | R→M       | `url` (string) → void (allow-listed: `https`/`http`/`mailto`)                                                                                                   |
| `themes:list`                         | R→M       | → `Theme[]` (built-ins + user)                                                                                                                                  |
| `themes:openFolder`                   | R→M       | → void                                                                                                                                                          |
| `renderer:ready` / `renderer:flushed` | R→M       | signals                                                                                                                                                         |
| `watch:changed` / `watch:missing`     | M→R       | `{ path, mtimeMs?, size? }`                                                                                                                                     |
| `files:opened`                        | M→R       | `{ paths }` (from `open-file`, dialog, Dock)                                                                                                                    |
| `menu:action`                         | M→R       | `{ type: 'find' \| 'replace' \| 'toggleSidebar' \| 'openSettings' \| 'showWhatsNew' \| 'zoomIn' \| 'zoomOut' \| 'zoomReset' \| 'closeFile' \| 'newFile' \| … }` |
| `themes:changed`                      | M→R       | `Theme[]` (user theme folder hot reload)                                                                                                                        |
| `appearance:changed`                  | M→R       | `'light' \| 'dark'` (nativeTheme)                                                                                                                               |
| `renderer:flush`                      | M→R       | request flush before quit                                                                                                                                       |

Every R→M handler validates types and paths; path-bearing calls other than `files:add`/`file:create` require the path to be in `state.files`. Every handler also checks `event.senderFrame.url` against our renderer origins (`file://` build, or the dev server URL) via `trustedSenderFor`. Text acceptance: accepted extension (`.md .markdown .txt .text`) or the first 8 KB has no NUL and decodes as UTF-8. The preload's `pathForFile` wraps `webUtils.getPathForFile` and returns `""` for anything that is not a disk file.

## Editor (`src/renderer/editor/`)

- `Editor` owns one `EditorView` and a `Map<path, EditorState>`; switching files swaps states so undo history and unsaved edits survive, reopening reuses the state. `replaceText` swaps a document keeping a clamped caret (external reload). Caret/scroll changes are debounced 300 ms (only real selection/doc changes count, not CodeMirror's focus transactions) and persisted via `Store.setFileView` → `state:patch`.
- `Store` (renderer) applies patches locally first, then forwards to main; `Notice` is the single bar above the editor (missing file, large file, conflicts); `Sidebar` renders from state (`displayName` strips accepted extensions, `is-active`, `is-missing`).

- CodeMirror 6: `EditorState` + `EditorView`, `markdown({ base: markdownLanguage, codeLanguages })` with a bundled language set (JavaScript/TypeScript, JSON, HTML, CSS, Python, Shell, SQL, YAML, Markdown, Go, Rust); unknown fences get generic string/comment/bracket colouring via a tiny fallback grammar.
- Extensions: `history` (one per file, kept in a `Map<path, EditorState>` while the app runs), `drawSelection`, `highlightSelectionMatches`, `search` (Cmd+F / Cmd+Alt+F), `EditorView.lineWrapping`, `indentUnit` = two spaces, `insertNewlineAndIndent` replaced by a copy-leading-whitespace command, `rainbowBrackets` (three colours, only inside fenced code nodes), `keymap` with no auto-close brackets and no list continuation.
- Content attributes: `spellcheck=false autocorrect=off autocapitalize=off` (CM default), plus `webPreferences.spellcheck: false`.
- `HighlightStyle` maps Lezer tags to `te-*` classes (`SYNTAX_CLASSES`); `styles.css` colours those classes from `--te-syntax-*` tokens, so a theme switch is a variable swap and tests assert classes. Headings are colour only; strong is bold, emphasis italic; nothing changes size.
- Fenced code: `languages.ts` lists `LanguageDescription`s (JS/TS, JSON, HTML, CSS, Python, Shell, SQL, YAML, Go, Rust) loaded lazily on first use; unknown or missing info strings fall back to `genericLanguage`, a stream tokenizer for strings, comments and numbers. `rainbow.ts` decorates `()[]{}` inside `FencedCode` bodies with `te-bracket-1..3` by nesting depth (prose untouched).
- Copy buttons (`copy.ts`): a `ViewPlugin` decorates each `InlineCode` span with a floating copy button (a zero-size anchor after the span, so no reflow) and each `FencedCode` block with a button pinned to the top-right of its opening fence line. Buttons are hover-revealed (inline: the containing `.cm-line`; block: any line of the block, via `posAtDOM` on `mouseover`). Clicking copies the inner text only — between the backticks for inline, the body excluding the fence lines and info string for blocks — through `api.copyText` → `clipboard:write`. Buttons are decoration widgets, never document text, so the file is untouched.
- Code-block background (`codeblock.ts`): a `ViewPlugin` adds a `te-codeblock-line` line decoration to every line of each `FencedCode` block (fence lines included), tagging the first/last with corner classes. The editor theme paints them as a subtle inset panel — `--te-surface-container` fill, `--te-line` border, a small horizontal margin (edge to edge bar the margin) with reduced padding so the text keeps its x position, rounded top/bottom and no vertical margin so the lines read as one continuous box. Decorations only, so the text is untouched.
- Line endings: on read, detect `\r\n` vs `\n` (first occurrence wins; mixed files are preserved by splitting on `\n` only and keeping `\r` in the text); on write, the detected EOL is re-applied. No final newline added or removed.
- Files > 10 MB open with a one-line warning in the conflict-bar slot.

## Themes (`src/shared/themes.ts`)

- Default for a new install: Automatic with macOS Light / macOS Dark (Fixed: macOS Light); `DEFAULT_LIGHT_ID` / `DEFAULT_DARK_ID` are also the fallbacks when a chosen theme is missing.
- Eight built-ins: Meadow (light), Tokyo Night, Catppuccin Latte (light), Frappé, Macchiato, Mocha (dark), macOS Light (light), macOS Dark (dark). UI roles are the hub's; syntax palettes are the canonical Tokyo Night / Catppuccin colours, and Apple's system / Xcode Default (Light / Dark) accents for the two macOS themes. `resolveTheme(setting, themes, appearance)` never fails (falls back to the defaults, then Meadow).
- Main: `UserThemes` loads `userData/themes/*.json` (defensive `parseUserTheme`: id from the file name, appearance from surface luminance, tokens filled from the matching built-in), watches the folder (200 ms debounce) and pushes `themes:changed`; `nativeTheme.updated` pushes `appearance:changed`; both plus theme-state changes rebuild the View → Theme menu (Automatic / fixed radios, Light/Dark-for-Automatic submenus, Open Themes Folder) and re-set the window's `backgroundColor` to the theme surface so nothing flashes.
- Renderer: `applyTheme` writes every `--te-*` variable (`themeCssVars`), `data-appearance`, `data-theme` and `color-scheme` on `<html>`; re-painted on theme-state, theme-list and appearance changes. A unit test checks that every `var(--te-*)` used in `styles.css` is produced by `themeCssVars` (layout vars excepted) and that the CSS defaults equal Meadow.

```ts
type Theme = {
  id: string;
  name: string;
  builtin: boolean;
  appearance: "light" | "dark";
  tokens: ThemeTokens;
};
type ThemeTokens = {
  colors: {
    surface;
    surfaceContainer;
    surfaceContainerHigh;
    card;
    line;
    ink;
    muted;
    primary;
    onPrimary;
    primaryContainer;
    onPrimaryContainer;
    secondaryContainer;
    sel;
    danger;
    dangerContainer;
    inverseSurface;
    inverseOnSurface;
    inversePrimary;
  }; // hub roles, #rrggbb
  syntax: {
    heading;
    strong;
    emphasis;
    link;
    url;
    inlineCode;
    codeBlock;
    codeFence;
    quote;
    listMarker;
    hr;
    keyword;
    string;
    number;
    comment;
    operator;
    typeName;
    functionName;
    property;
    bracket1;
    bracket2;
    bracket3;
  }; // #rrggbb
  radius: number; // 0–24, scale derived ×0.5 / ×1 / ×1.5 / ×2.5
  fontFamily: string; // installed/system fonts only; no downloads
};
```

- Built-ins: Meadow (light), Tokyo Night (dark), Catppuccin Latte (light), Frappé, Macchiato, Mocha (dark), macOS Light (light), macOS Dark (dark); the first six ported from the hub with syntax palettes added, macOS Light / Dark from Apple's system light / dark colours + Xcode Default (Light / Dark) syntax accents.
- `parseThemeTokens(raw)` falls back field by field to Meadow; colours must match `^#[0-9a-fA-F]{6}$`, radius clamps to 0–24.
- `themeCssVars(tokens)` → `--te-<kebab-role>` and `--te-syntax-<kebab-role>`, set on `<html>`; the main window's `backgroundColor` is updated to the new surface on switch.
- Mode `auto` picks `theme.light` / `theme.dark` from `nativeTheme.shouldUseDarkColors`; mode `fixed` uses `theme.fixed`.
- User themes: `userData/themes/*.json` matching `Theme` minus `builtin`; folder watched, invalid files skipped with a console warning; View → Theme → Open Themes Folder.

## Read-only pages (`src/renderer/pages/`)

- `welcome.md` and `whats-new.md` are bundled with Vite `?raw` imports (`pages.ts`); never written to disk, never in the sidebar.
- `Editor.showPage(text)` shows Markdown in a read-only `EditorState` with the normal highlighting, copy and link extensions but no save/view hooks; the active file's state is kept, so reopening it restores text, undo history and caret.
- **Welcome:** the editor's `placeholder`; shown at launch with no `activePath` and whenever the active file is closed.
- **What's New:** Help → What's New relays `menu:action { type: 'showWhatsNew' }` → the renderer flushes the active file, sets `activePath` to null (window title becomes "Tiny Edit") and shows the page. Clicking a file returns to it. Sections are per version (`## 0.2.0 — YYYY-MM-DD`), newest first, with an "Unreleased" block on top until a version is cut.

## Settings (`src/renderer/settings/`)

- App menu → Settings… (Cmd+,) relays `menu:action { type: 'openSettings' }`; the renderer toggles an in-window overlay panel (`role="dialog"`, Esc / backdrop / Done close it, focus returns to the editor). No second window, no extra IPC: the panel reads the store and the theme list and persists through the existing `state:patch`.
- **Theme:** Automatic (with the Light / Dark pair) or Fixed (one theme); the same `ThemeState` the View → Theme menu edits, so both stay in sync (menu rebuild on state change, panel `update()` on store/theme-list change).
- **Font size:** a slider over `FONT_SLIDER_RANGE` (10–18 px in 1 px steps; default 14 px). It writes `fontSize` exactly like Cmd+/− zoom; a zoomed size outside the range pins the thumb to the nearest end while the label shows the real size.
- **Syntax highlighting:** a checkbox bound to `highlight` (default on). Off puts `highlight-off` on `<html>` (`applyViewState`) and a rule in `styles.css` makes every `te-*` syntax class inherit colour, weight, slant and decoration, so all text is the body colour. Purely CSS: the Markdown parser, the fenced-code grammars, the code-block panel, bracket-match and search backgrounds, copy and open-link buttons all keep working.
- Styles live in `settings/settings.css` (linked from `index.html`), tokens only; the CSS-variable coverage test scans it too.

## Window

- `titleBarStyle: 'hiddenInset'`, `trafficLightPosition` tuned so the lights sit in the sidebar header; a 38 px drag region across the top with `-webkit-app-region: no-drag` on controls.
- `setRepresentedFilename(activePath)` and `setTitle(basename)` on switch; `setDocumentEdited` is not used (autosave).
- Single window; `window-all-closed` quits (macOS included, since the app is document-less without its window).
- Default 950×500 (750 editor + 200 sidebar), min 400×300; `ApplePressAndHoldEnabled=false` for key repeat.

## Build & packaging

- electron-vite bundles `src/main` → `out/main/index.js` and `src/preload` → `out/preload/index.js` as CommonJS (sandboxed preloads must be CJS; ESM preloads require `sandbox: false`). The renderer is a normal Vite build in `out/renderer/`. Dev mode loads `ELECTRON_RENDERER_URL` from the Vite dev server; production loads `app://renderer/index.html` through `protocol.handle` (`src/main/appProtocol.ts`). The CSP meta tag works in both because Vite's HMR client is same-origin and `app://renderer` is a standard, secure scheme.

- `npm run package` → electron-vite build → electron-builder `mac` target `dir` (arm64) → `dist/mac-arm64/Tiny Edit.app`. Ad-hoc signed (`identity: "-"`), `hardenedRuntime: false`, no notarisation, no `.dmg` (personal use). `fileAssociations` register `.md/.markdown` and `.txt/.text`. Fuses flipped in the packaged app only (`electronFuses` in `electron-builder.yml`): RunAsNode off, NodeOptions env off, Node CLI inspect off, cookie encryption on, embedded ASAR integrity on, only-load-from-ASAR on, file-protocol extra privileges off. All runtime JS is bundled by Vite, so `package.json` has no `dependencies` and the ASAR carries only `out/`. `npm run install:app` packages and copies the bundle to `/Applications/Tiny Edit.app` with `sudo ditto` (writing to `/Applications` from a shell needs admin rights; signature preserved; first launch registers the file associations); `install:app:user` targets `~/Applications` instead. Icon: `logo.png` (1254×1254 RGBA) is the artwork; `npm run icon` (`scripts/make-icon.mjs`, Node + macOS `sips`/`iconutil`) renders `build/icon.png` (1024×1024, fully opaque: the logo's dominant brown edge to edge, artwork centred at 1200 px) and packs `build/icon.icns` from it. electron-builder ships that `.icns` untouched. Full bleed because macOS masks legacy icons to its squircle and shrinks any icon with transparent margins onto a grey tile; the original artwork is also only ~90 % opaque. electron-builder's own PNG→icns conversion is bypassed because it wrote noise into the 16 px size. Re-run `npm run icon` whenever `logo.png` changes.

## Testing map

| Area                                      | Unit (Vitest)                                                                                                  | E2E (Playwright `_electron`)                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| state, windowState                        | parse/defaults/corrupt file, debounce, display validation                                                      | size on first launch, restore after relaunch                                  |
| files, text                               | atomic write, EOL detection, UTF-8 sniff, accept rules, create                                                 | open, switch, autosave visible on disk                                        |
| watcher                                   | self-write suppression, debounce, missing file                                                                 | external edit → reload keeps caret; dirty → conflict bar                      |
| ipc                                       | every handler's validation, rejects foreign paths                                                              | —                                                                             |
| preload                                   | API shape, unsubscribe, getPathForFile wrapper                                                                 | —                                                                             |
| renderer: sidebar, store, conflict, theme | DOM behaviour in happy-dom                                                                                     | drop via `files:add`, reorder, remove, Cmd+W, Cmd+\                           |
| editor                                    | commands (Tab, Enter), highlight tags → vars, no auto-insert                                                   | type `"`/`(`/`"` and assert bytes unchanged; theme switch                     |
| outline (toc, scope)                      | parseToc levels/ranges/fences, hasOutline, scope field mapping + changeFilter, sidebar chevron/TOC, applyScope | chevron scopes to a section, editing writes the whole file, name clears scope |
