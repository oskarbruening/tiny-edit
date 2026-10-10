# What's New in Tiny Edit

## 0.3.1 — 2026-10-09

- **No more blank screen on file switch.** Jumping from the bottom of a long file to a shorter one keeps you on the text instead of stranding you in empty space below it. If a file shrinks while you're reading it, the view stays on the content.
- **Each section remembers its scroll.** When you use the outline to move between sections, returning to a section brings you back to where you were in it, not its top.
- **Open from the command line.** Run `tiny-edit my-notes.md` in a terminal and the file opens here, added to the sidebar. (Set the command up once with the install step in the project README.)
- **Open With Tiny Edit in Finder.** Right-click any file Tiny Edit can read — Markdown, text, JSON, YAML, CSV, HTML and many more — and Tiny Edit now appears under "Open With". It never takes over as the default for a type unless you choose it yourself.

## 0.3.0 — 2026-10-08

- **Recently Closed.** The File menu now has a Recently Closed submenu with the last 50 files you removed from the sidebar, newest first. Choose one to reopen it. If two have the same name, their folder is shown so you can tell them apart. The list is kept across restarts.
- **Proper highlighting for JSON, HTML, XML, YAML and TOML.** These files now get their own colours instead of being treated as Markdown (SVG is highlighted as XML).
- **Pretty Format.** Edit → Pretty Format (⇧⌥F) tidies the current Markdown, JSON, HTML, XML or YAML file with two-space indentation and saves it. Press ⌘Z to undo. If the file has a syntax error, Tiny Edit tells you and leaves it untouched. (TOML is highlighted but not reformatted.)

## 0.2.1 — 2026-10-08

- **Your bytes are safe.** Files that aren't UTF-8 (old Latin-1 or UTF-16 text) open read-only instead of being rewritten with � characters. Classic Mac line endings and stray carriage returns are kept exactly.
- **No silent data loss on quit.** If a "Changed on disk" bar or a failed save is still open, quitting asks before anything is discarded.
- **Drop onto the editor** opens the file in the sidebar; its text is no longer pasted into what you were writing.
- **More formats.** JSON, YAML, TOML, INI, CSV, XML, HTML, CSS, common source code and extensionless text files open directly. A file that can't be opened now tells you why.
- **Remove from Sidebar** is the one name for ⌘W and the right-click action, with Undo for a few seconds afterwards.
- **Quieter syncing.** A file touched by Dropbox, iCloud or git without changing its content no longer reloads or shows a conflict; a real change keeps your undo history and caret.
- **Fewer surprises.** Shortcuts that silently rewrote text (⌘/ comment, ⌥↑↓ move lines, ⌘] indent, ⌘I) are gone; Backspace deletes one character.
- **Outline** also lists headings underlined with `===` or `---`; returning to a file restores its scroll position; Tab stays inside Settings.

## 0.2.0 — 2026-10-08

- **Welcome page.** With no file selected, the editor shows a short guide to autosave, highlighting and shortcuts.
- **What's New.** Help → What's New shows this page.
- **Font size slider** now moves in 1 px steps (10–18 px).
- **New default themes.** A fresh install uses macOS Light and macOS Dark, following the system appearance.
- **macOS Light theme**, a match for Apple's light appearance with Xcode-style code colours.
- **Syntax highlighting switch** in Settings: turn all colours off and keep plain text.
- **Code blocks** sit in a soft, rounded panel.
- **Links** show an open button on hover and open with ⌘-click.
- **Copy buttons** on inline code and code blocks copy just the content.
- **Outline** in the sidebar for files with two or more headings; click one to focus on that section.
- **macOS Dark theme**, a match for Apple's dark appearance.
- **Settings** window (⌘,) for theme and font size.
- **New app icon.**

## 0.1.0 — 2026-10-07

- First release: Markdown and plain-text editing with highlighting, autosave, a file sidebar, themes and Finder integration.
