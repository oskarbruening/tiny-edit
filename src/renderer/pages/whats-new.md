# What's New in Tiny Edit

## Unreleased

- **Your bytes are safe.** Files that aren't UTF-8 (old Latin-1 or UTF-16 text) open read-only instead of being rewritten with � characters. Classic Mac line endings and stray carriage returns are kept exactly.
- **No silent data loss on quit.** If a "Changed on disk" bar or a failed save is still open, quitting asks before anything is discarded.
- **Drop onto the editor** opens the file in the sidebar; its text is no longer pasted into what you were writing.
- **More formats.** JSON, YAML, TOML, INI, CSV, XML, HTML, CSS, common source code and extensionless text files open directly. A file that can't be opened now tells you why.
- **Remove from Sidebar** is the one name for ⌘W and the right-click action, with Undo for a few seconds afterwards.
- **Quieter syncing.** A file touched by Dropbox, iCloud or git without changing its content no longer reloads or shows a conflict; a real change keeps your undo history and caret.
- **Fewer surprises.** Shortcuts that silently rewrote text (⌘/ comment, ⌥↑↓ move lines, ⌘] indent, ⌘I) are gone; Backspace deletes one character.
- **Outline** also lists headings underlined with `===` or `---`; returning to a file restores its scroll position; Tab stays inside Settings.
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
