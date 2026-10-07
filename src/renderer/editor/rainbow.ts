import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export const BRACKET_COLOURS = 3;
const OPEN = "([{";
const CLOSE = ")]}";

const marks = Array.from({ length: BRACKET_COLOURS }, (_, i) =>
  Decoration.mark({ class: `te-bracket-${i + 1}` }),
);

/** Fenced-code bodies in the document as [from, to) ranges (Lezer `FencedCode` minus its fence lines). */
export function fencedCodeRanges(view: EditorView): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const text = view.state.doc.sliceString(node.from, node.to);
      const open = text.indexOf("\n");
      if (open === -1) return false;
      const lastBreak = text.lastIndexOf("\n");
      const to =
        lastBreak > open && /^\s*(`{3,}|~{3,})\s*$/.test(text.slice(lastBreak + 1))
          ? node.from + lastBreak
          : node.to;
      out.push({ from: node.from + open + 1, to });
      return false;
    },
  });
  return out;
}

/** Nested brackets inside fenced code cycle through three colours; prose is left alone (Q23). */
export function bracketDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of fencedCodeRanges(view)) {
    let depth = 0;
    const text = view.state.doc.sliceString(range.from, range.to);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (OPEN.includes(ch)) {
        builder.add(range.from + i, range.from + i + 1, marks[depth % BRACKET_COLOURS]!);
        depth++;
      } else if (CLOSE.includes(ch)) {
        depth = Math.max(0, depth - 1);
        builder.add(range.from + i, range.from + i + 1, marks[depth % BRACKET_COLOURS]!);
      }
    }
  }
  return builder.finish();
}

export const rainbowBrackets = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = bracketDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      )
        this.decorations = bracketDecorations(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);
