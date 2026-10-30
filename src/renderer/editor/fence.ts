import { syntaxTree } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/**
 * True when the line holding `pos` belongs to a `FencedCode` node (an unclosed fence runs to the
 * end of its block). Resolved at the line start, leaning forward: a closed block's node ends at
 * the start of the line after its closing fence, and that line is not part of it.
 */
export function insideFencedCode(state: EditorState, pos: number): boolean {
  const lineStart = state.doc.lineAt(pos).from;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(lineStart, 1); node; node = node.parent)
    if (node.name === "FencedCode") return true;
  return false;
}

/**
 * The third keyboard convenience: typing the third backtick of an opening fence adds the closing
 * fence on the line below. The transaction for inserting `text` at `from`..`to`, or null when the
 * input is anything else — a plain backtick, a fence being closed by hand, text after the caret,
 * a selection, or more than one cursor — so the default insertion applies.
 *
 * Before: `  ``|`  →  after: `  ```|` + newline + `  ``` ` (the closing fence copies the opening
 * line's leading whitespace; the caret stays after the opening fence for the info string).
 */
export function fenceCompletion(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): TransactionSpec | null {
  if (text !== "`" || from !== to) return null;
  const sel = state.selection;
  if (sel.ranges.length !== 1 || !sel.main.empty || sel.main.from !== from) return null;
  const line = state.doc.lineAt(from);
  if (from !== line.to) return null;
  const open = /^(\s*)``$/.exec(line.text);
  if (!open) return null;
  if (insideFencedCode(state, from)) return null;
  return {
    changes: { from, insert: "`\n" + open[1] + "```" },
    selection: { anchor: from + 1 },
    scrollIntoView: true,
    userEvent: "input.type",
  };
}

/**
 * An input handler rather than a key binding, so the third backtick is recognised however it was
 * produced (a plain key, a dead-key layout, an IME) and the default insertion stays untouched for
 * every other input.
 */
export const autoCloseFence = EditorView.inputHandler.of((view, from, to, text) => {
  const spec = fenceCompletion(view.state, from, to, text);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
});
