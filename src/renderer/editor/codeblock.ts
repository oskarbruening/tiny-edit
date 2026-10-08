import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

/** The lines a `FencedCode` node spans, from its opening fence through its closing fence. */
function blockLines(state: EditorState, from: number, to: number): number[] {
  const lines: number[] = [];
  const doc = state.doc;
  let n = doc.lineAt(from).number;
  while (n <= doc.lines) {
    const line = doc.line(n);
    if (line.from >= to) break; // past the block (handles a node ending at the next line's start)
    lines.push(n);
    n++;
  }
  return lines;
}

export type VisibleRange = { from: number; to: number };

/** The whole document as one range (for tests and callers without a view). */
export const wholeDoc = (state: EditorState): VisibleRange[] => [{ from: 0, to: state.doc.length }];

/**
 * One line decoration per line of every fenced code block that touches `ranges` (the viewport,
 * so a keystroke never walks the whole tree); first/last carry the rounded-corner classes.
 */
export function buildCodeBlocks(
  state: EditorState,
  ranges: readonly VisibleRange[] = wholeDoc(state),
): DecorationSet {
  const out: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const { from, to } of ranges)
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "FencedCode") return undefined;
        if (seen.has(node.from)) return false;
        seen.add(node.from);
        const nums = blockLines(state, node.from, node.to);
        nums.forEach((n, i) => {
          const classes = ["te-codeblock-line"];
          if (i === 0) classes.push("te-codeblock-first");
          if (i === nums.length - 1) classes.push("te-codeblock-last");
          out.push(Decoration.line({ class: classes.join(" ") }).range(state.doc.line(n).from));
        });
        return false;
      },
    });
  return Decoration.set(out, true);
}

class CodeBlockPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildCodeBlocks(view.state, view.visibleRanges);
  }

  update(u: ViewUpdate): void {
    if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state))
      this.decorations = buildCodeBlocks(u.state, u.view.visibleRanges);
  }
}

/** Gives every fenced code block a subtle inset panel background with a border (styling lives in the editor theme). */
export const codeBlockBackground = ViewPlugin.fromClass(CodeBlockPlugin, {
  decorations: (p) => p.decorations,
});
