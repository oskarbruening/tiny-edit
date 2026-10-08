import {
  deleteCharBackwardStrict,
  history,
  historyKeymap,
  insertNewlineKeepIndent,
  simplifySelection,
  standardKeymap,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { bracketMatching, indentUnit } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightSpecialChars,
  keymap,
  type KeyBinding,
  scrollPastEnd,
} from "@codemirror/view";
import { codeBlockBackground } from "./codeblock";
import { insertTwoSpaces, outdent } from "./commands";
import { codeLanguages, genericLanguage } from "./languages";
import { rainbowBrackets } from "./rainbow";
import { scopeExtension } from "./scope";
import { editorTheme, highlighting, markdownTagExtension } from "./theme";

/**
 * The editing keys: caret movement, selection, plain deletion and select-all (CodeMirror's
 * `standardKeymap`), with Backspace deleting exactly one character — never a whole indent
 * unit. `defaultKeymap` is deliberately not used: it adds line moves, line copies,
 * indent/outdent, comment toggling and syntax selection, none of which are documented
 * conveniences (CLAUDE.md product rule 1). Escape collapses multiple selections to one.
 */
export const editingKeymap: readonly KeyBinding[] = [
  { key: "Backspace", run: deleteCharBackwardStrict, shift: deleteCharBackwardStrict, preventDefault: true },
  ...standardKeymap.filter((b) => b.key !== "Backspace"),
  { key: "Escape", run: simplifySelection },
];

/**
 * Finder drops are handled window-wide (dropzone.ts) and mean "open these files". CodeMirror
 * would otherwise read a dropped file and paste its contents into the document; claiming the
 * event here stops that while it still bubbles up to the window handler.
 */
export const fileDropGuard = EditorView.domEventHandlers({
  drop: (event) => (event.dataTransfer?.files?.length ?? 0) > 0,
});

/**
 * Markdown is the top-level grammar for prose, plain text and source files; `markdownLanguage`
 * nests fenced code and inline HTML, with the custom list-mark tag for highlighting.
 */
export function markdownSupport(): Extension {
  return markdown({
    base: markdownLanguage,
    addKeymap: false,
    codeLanguages,
    defaultCodeLanguage: genericLanguage,
    extensions: [markdownTagExtension],
  });
}

/**
 * The product rules as CodeMirror configuration. Order matters: our keys win over defaults.
 * `language` overrides the top-level grammar (JSON/HTML/XML files); it defaults to Markdown.
 * The Markdown-only decorations (code-block panel, rainbow brackets) are harmless on other
 * grammars — they walk Markdown node types that those documents simply do not contain.
 */
export function editorExtensions(extra: readonly Extension[] = [], language?: Extension | null): Extension[] {
  return [
    // Nothing may rewrite the user's text (CLAUDE.md product rule 1).
    EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
    // Lines split on LF only, so a stray `\r` inside an LF file stays a character and survives a save.
    EditorState.lineSeparator.of("\n"),
    // A stray control character (such as that `\r`) is shown as a placeholder instead of vanishing.
    highlightSpecialChars(),
    fileDropGuard,
    keymap.of([
      { key: "Enter", run: insertNewlineKeepIndent, shift: insertNewlineKeepIndent },
      { key: "Tab", run: insertTwoSpaces, shift: outdent },
    ]),
    indentUnit.of("  "),
    history(),
    drawSelection(),
    bracketMatching(),
    scrollPastEnd(),
    EditorView.lineWrapping,
    search({ top: true }),
    // addKeymap: false keeps list continuation and other markup helpers off. Fenced code picks
    // its grammar from the info string; unknown or missing → the generic string/comment colouring.
    language ?? markdownSupport(),
    codeBlockBackground,
    highlighting,
    rainbowBrackets,
    editorTheme,
    scopeExtension,
    keymap.of([...searchKeymap, ...historyKeymap, ...editingKeymap]),
    EditorState.allowMultipleSelections.of(true),
    ...extra,
  ];
}
