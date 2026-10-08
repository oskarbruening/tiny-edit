import { defaultKeymap, history, historyKeymap, insertNewlineKeepIndent } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { bracketMatching, indentUnit } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap, scrollPastEnd } from "@codemirror/view";
import { codeBlockBackground } from "./codeblock";
import { insertTwoSpaces, outdent } from "./commands";
import { codeLanguages, genericLanguage } from "./languages";
import { rainbowBrackets } from "./rainbow";
import { scopeExtension } from "./scope";
import { editorTheme, highlighting, markdownTagExtension } from "./theme";

/** The product rules as CodeMirror configuration. Order matters: our keys win over defaults. */
export function editorExtensions(extra: readonly Extension[] = []): Extension[] {
  return [
    // Nothing may rewrite the user's text (CLAUDE.md product rule 1).
    EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
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
    markdown({
      base: markdownLanguage,
      addKeymap: false,
      codeLanguages,
      defaultCodeLanguage: genericLanguage,
      extensions: [markdownTagExtension],
    }),
    codeBlockBackground,
    highlighting,
    rainbowBrackets,
    editorTheme,
    scopeExtension,
    keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
    EditorState.allowMultipleSelections.of(true),
    ...extra,
  ];
}
