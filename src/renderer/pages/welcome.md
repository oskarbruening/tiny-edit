# Welcome to Tiny Edit

A small, fast editor for **Markdown** and plain-text files. Pick a file in the sidebar, or:

- Drop `.md` or `.txt` files (or a folder) anywhere in the window
- Press `⌘N` for a new file, or `⌘O` to open one
- Choose Help → What's New to see recent changes

## Your words are always saved

There is no Save button. Every change is written to disk **300 ms after you stop typing**, and again when you switch files, leave the window or quit. Writes are atomic, so a crash never leaves half a file behind.

- If another app changes a file you have not edited, Tiny Edit reloads it and keeps your caret.
- If you have unsaved edits too, a bar asks you to _Reload_ or _Keep mine_. Nothing is thrown away silently.
- Removing a file from the sidebar never deletes it from disk.

## Your text stays yours

Tiny Edit never changes what you type: no autocorrect, no smart quotes, no auto-closing brackets, no list continuation, no trimmed whitespace. Line endings stay as they were. Only two helpers exist:

- `Tab` inserts two spaces
- `Enter` copies the indent of the line above

## Highlighting, not hiding

Markdown syntax stays visible. It gets colour, never a different size:

- `# Headings` and `## subheadings` are coloured
- **Strong** text is bold, _emphasis_ is italic
- `inline code` and [links](https://example.com) stand out
- > Quotes, list markers and rules are tinted

Fenced code blocks sit in a soft panel and are highlighted by language:

```ts
function greet(name: string): string {
  return `Hello, ${name}!`; // brackets get rainbow colours
}
```

Turn colours off in Settings (`⌘,`) → _Syntax highlighting_.

## Handy features

- **Copy buttons**: hover inline code or a code block to copy just its content
- **Links**: hover a link for an open button, or `⌘`-click it
- **Outline**: a file with two or more `#` or `##` headings gets a chevron in the sidebar; click a heading to focus on that section
- **Find and replace**: `⌘F` and `⌘⌥F`
- **Font size**: `⌘=`, `⌘-`, `⌘0`, or the slider in Settings
- **Sidebar**: `⌘\` hides it, drag the edge to resize, drag files to reorder
- **Themes**: View → Theme, or Settings; Automatic follows macOS light and dark mode
- **Close a file**: `⌘W` removes it from the list (the file stays on disk)
