# Welcome to Tiny Edit

A small, fast editor for plain-text and markdown files.

## Key Features

- Drop files from anywhere into the sidebar as a shortcut
  - The sidebar is like a list of shortcuts which you can reorder
  - Reordering or removing files from the sidebar (⌘W, with Undo) won't change the file itself
  - Markdown, plain text, JSON, YAML, CSV, HTML, source code and other UTF-8 text files open directly
- Every change is autosaved so no save button
- Pure text editing: no auto-correct, no smart quotes, no auto-closing brackets
- Basic markdown highlighting (disable in settings)
  - Quick copy buttons for `code spans` and code blocks (see below)
  - H1 and h2 headers (`#` and `##`) show up in the sidebar as a table-of-content
  - Links like this https://edensrise.com have an open-in-browser button on hover
  - JSON, HTML, XML, YAML and TOML files get their own syntax highlighting
- Pretty Format (⇧⌥F) tidies a Markdown, JSON, HTML, XML or YAML file with two-space indentation
- Support for all the usual "⌘N" (new file), "⌘O" (open file)
  - File → Recently Closed reopens files you removed from the sidebar (last 50)
- Themes available and customizable in settings

## Code Block Example

```ts
function greet(name: string): string {
  return `Hello, ${name}!`; // brackets get rainbow colours
}
```

## Next Step

Open Finder and drop a text file into the sidebar.
