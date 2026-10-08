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

/** One line decoration per line of every fenced code block; first/last carry the rounded-corner classes. */
export function buildCodeBlocks(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return undefined;
      const nums = blockLines(state, node.from, node.to);
      nums.forEach((n, i) => {
        const classes = ["te-codeblock-line"];
        if (i === 0) classes.push("te-codeblock-first");
        if (i === nums.length - 1) classes.push("te-codeblock-last");
        ranges.push(Decoration.line({ class: classes.join(" ") }).range(state.doc.line(n).from));
      });
      return false;
    },
  });
  return Decoration.set(ranges, true);
}

class CodeBlockPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildCodeBlocks(view.state);
  }

  update(u: ViewUpdate): void {
    if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state))
      this.decorations = buildCodeBlocks(u.state);
  }
}

/** Gives every fenced code block a subtle inset panel background with a border (styling lives in the editor theme). */
export const codeBlockBackground = ViewPlugin.fromClass(CodeBlockPlugin, {
  decorations: (p) => p.decorations,
});
