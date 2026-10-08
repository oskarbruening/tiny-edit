# Changelog

## Unreleased

- 2026-10-07 — Outline: a file with two or more `#` or `## ` headings shows a chevron in the sidebar; expand it for a flattened table of contents (H2s indented) and click a heading to focus the editor on just that section (an H1 includes its H2s). Editing the focused section still saves the whole file; click the file name to see all of it again.

- 2026-10-07 — Themes: added "macOS Dark", a built-in dark theme matching Apple's system dark appearance (textBackground surface, systemBlue accent, SF Mono) with Xcode Default (Dark) syntax accents.

- 2026-10-07 — Settings: App menu → Settings… (Cmd+,) opens an in-window panel to choose the theme (Automatic with a light/dark pair, or Fixed) and the editor font size with a five-step slider (10–18 px, 14 px in the middle).

- 2026-10-07 — Fix: the app icon showed a grey tile around the logo and a garbled small icon in Finder lists; it is now a solid dark full-bleed icon with a correctly built `.icns`. `npm run icon` regenerates both from `logo.png`.

## 0.1.0 — 2026-10-07

- 2026-10-07 — Fix: long documents did not scroll (the editor grew past the window); the editor now scrolls inside its pane and keeps the caret in view.

- 2026-10-07 — Fix: the packaged app showed an empty window (renderer never loaded under the production fuses); the renderer is now served from a private `app://` scheme instead of `file://`.

- 2026-10-07 — Packaging: `npm run package` builds an ad-hoc signed `Tiny Edit.app` (arm64) with the logo icon, `.md`/`.txt` file associations and production Electron fuses; bundled JS only, no runtime node_modules.

- 2026-10-07 — Themes: Meadow, Tokyo Night and the four Catppuccin flavours; Automatic mode follows macOS light/dark with a configurable pair; custom themes as JSON in the themes folder (View → Theme → Open Themes Folder), hot-reloaded; window background follows the theme.

- 2026-10-07 — Highlighting: fenced code blocks get JS/TS, JSON, HTML, CSS, Python, Shell, SQL, YAML, Go and Rust grammars (loaded on first use), a generic string/comment/number colouring for everything else, and three-colour nested brackets; headings are colour only.

- 2026-10-07 — Files in and out: drop files anywhere in the window, Finder/Dock open, File → Open…, Cmd+N inline new-file, Cmd+W / context-menu Remove from List (disk untouched), Reveal in Finder, Copy Path; application menu with Find, Toggle Sidebar (Cmd+\\) and Zoom; window title and proxy icon follow the active file; drag files in the sidebar to reorder; drag the divider to resize the sidebar.

- 2026-10-07 — External changes: files edited by other programs reload in place (caret kept) when unmodified here, show the Reload / Keep mine bar when modified here; deleted files dim in the sidebar; everything is re-checked when the window regains focus.

- 2026-10-07 — Autosave: 300 ms after the last edit, flush on file switch / window blur / hide / close (close waits for the renderer, max 2 s); external change with unsaved edits shows a Reload / Keep mine bar; failed writes show Retry.

- 2026-10-07 — Editor: CodeMirror 6 with Markdown highlighting (colour, bold, italic only), no autocorrect/spellcheck, Tab = two spaces, Enter keeps indentation, find/replace, soft wrap, bracket match; sidebar lists files (extensions stripped) with click-to-switch, missing-file notice, per-file caret/scroll persistence, in-memory per-file undo.

- 2026-10-07 — Files: read/write with BOM + CRLF preservation, atomic writes with an mtime/size conflict guard, new-file creation, drop acceptance (extension or UTF-8 sniff, folders one level deep), reveal-in-Finder and copy-path, IPC sender validation.

- 2026-10-07 — Persistence: versioned `state.json` in userData (atomic, debounced, flushed on quit, corrupt file moved aside), window size/position remembered and validated against connected displays, `state:get`/`state:patch` IPC with argument validation.

- 2026-10-07 — Project scaffold: Electron 44 + electron-vite + TypeScript, sandboxed window at 950×500 with inset title bar, security hardening, Vitest + Playwright test suites.
