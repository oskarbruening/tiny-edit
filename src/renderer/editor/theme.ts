import type { MarkdownConfig } from "@lezer/markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { styleTags, Tag, tags as t } from "@lezer/highlight";

/** lezer-markdown tags whole list bodies with `t.list`; we want only the bullet/number coloured. */
export const listMarkTag = Tag.define();
export const markdownTagExtension: MarkdownConfig = { props: [styleTags({ ListMark: listMarkTag })] };

/** Editor chrome. Only `var(--te-*)` tokens; no literal colours (see CLAUDE.md). */
export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--te-surface)",
    color: "var(--te-ink)",
    fontSize: "var(--te-font-size)",
  },
  // CodeMirror only sets overflow-x by default; without overflow: auto a tall document just grows past the host.
  ".cm-scroller": { fontFamily: "var(--te-font-mono)", lineHeight: "1.5", overflow: "auto" },
  ".cm-content": { caretColor: "var(--te-ink)", padding: "12px 0" },
  ".cm-line": { padding: "0 16px" },
  // Fenced code blocks: a subtle inset panel (edge to edge bar a small side margin) with a border.
  // Horizontal margin + reduced padding keep the text at the same x as ordinary lines; no vertical
  // margin, so consecutive block lines abut into one continuous panel.
  ".cm-line.te-codeblock-line": {
    backgroundColor: "var(--te-surface-container)",
    margin: "0 8px",
    padding: "0 7px",
    borderLeft: "1px solid var(--te-line)",
    borderRight: "1px solid var(--te-line)",
  },
  ".cm-line.te-codeblock-first": {
    borderTop: "1px solid var(--te-line)",
    borderTopLeftRadius: "var(--te-radius-sm)",
    borderTopRightRadius: "var(--te-radius-sm)",
    paddingTop: "2px",
  },
  ".cm-line.te-codeblock-last": {
    borderBottom: "1px solid var(--te-line)",
    borderBottomLeftRadius: "var(--te-radius-sm)",
    borderBottomRightRadius: "var(--te-radius-sm)",
    paddingBottom: "2px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--te-ink)" },
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "var(--te-sel)",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--te-syntax-bracket-match)",
    outline: "none",
  },
  ".cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "var(--te-danger-container)",
  },
  ".cm-panels": {
    backgroundColor: "var(--te-surface-container)",
    color: "var(--te-ink)",
    borderBottom: "1px solid var(--te-line)",
    fontFamily: "var(--te-font-mono)",
  },
  ".cm-panel.cm-search": { padding: "6px 10px" },
  ".cm-panel.cm-search input, .cm-panel.cm-search button": {
    fontFamily: "inherit",
    fontSize: "12px",
    color: "var(--te-ink)",
    backgroundColor: "var(--te-card)",
    border: "1px solid var(--te-line)",
    borderRadius: "var(--te-radius-sm)",
  },
  ".cm-panel.cm-search label": { fontSize: "12px", color: "var(--te-muted)" },
  ".cm-searchMatch": { backgroundColor: "var(--te-primary-container)" },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--te-primary)",
    color: "var(--te-on-primary)",
  },
});

/**
 * Lezer tags → `te-*` classes. All colour lives in styles.css against theme tokens, so a
 * theme switch is a CSS-variable swap and tests can assert classes. Only strong/emphasis
 * change weight or slant (Q21); nothing changes size.
 */
export const SYNTAX_CLASSES = {
  heading: "te-heading",
  strong: "te-strong",
  emphasis: "te-emphasis",
  strikethrough: "te-strikethrough",
  link: "te-link",
  url: "te-url",
  inlineCode: "te-inline-code",
  quote: "te-quote",
  listMarker: "te-list-marker",
  hr: "te-hr",
  marker: "te-marker",
  codeFence: "te-code-fence",
  htmlTag: "te-html-tag",
  keyword: "te-keyword",
  string: "te-string",
  number: "te-number",
  comment: "te-comment",
  operator: "te-operator",
  typeName: "te-type",
  functionName: "te-function",
  property: "te-property",
  variable: "te-variable",
  atom: "te-atom",
  meta: "te-meta",
  invalid: "te-invalid",
} as const;

const c = SYNTAX_CLASSES;

export const markdownHighlight = HighlightStyle.define([
  // Markdown
  { tag: t.heading, class: c.heading },
  { tag: t.strong, class: c.strong },
  { tag: t.emphasis, class: c.emphasis },
  { tag: t.strikethrough, class: c.strikethrough },
  { tag: t.link, class: c.link },
  { tag: t.url, class: c.url },
  { tag: t.monospace, class: c.inlineCode },
  { tag: t.quote, class: c.quote },
  { tag: listMarkTag, class: c.listMarker },
  { tag: t.contentSeparator, class: c.hr },
  { tag: [t.processingInstruction, t.escape], class: c.marker },
  { tag: t.labelName, class: c.codeFence },
  { tag: [t.tagName, t.angleBracket, t.attributeName], class: c.htmlTag },
  // Code
  {
    tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword],
    class: c.keyword,
  },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], class: c.string },
  { tag: [t.number, t.integer, t.float], class: c.number },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: c.comment },
  {
    tag: [
      t.operator,
      t.compareOperator,
      t.arithmeticOperator,
      t.logicOperator,
      t.definitionOperator,
      t.punctuation,
    ],
    class: c.operator,
  },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], class: c.typeName },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))],
    class: c.functionName,
  },
  { tag: [t.propertyName, t.attributeValue, t.definition(t.propertyName)], class: c.property },
  { tag: [t.variableName, t.definition(t.variableName), t.local(t.variableName), t.self], class: c.variable },
  { tag: [t.bool, t.null, t.atom, t.literal, t.unit, t.color], class: c.atom },
  { tag: [t.meta, t.annotation, t.macroName, t.documentMeta], class: c.meta },
  { tag: t.invalid, class: c.invalid },
]);

export const highlighting = syntaxHighlighting(markdownHighlight);
