import { indentLess, indentMore } from "@codemirror/commands";
import type { StateCommand } from "@codemirror/state";

/**
 * Tab: with a multi-line selection indent the lines by one unit; otherwise insert two
 * spaces at every cursor (replacing any selected text). Never inserts a tab character.
 */
export const insertTwoSpaces: StateCommand = ({ state, dispatch }) => {
  const multiLine = state.selection.ranges.some(
    (r) => !r.empty && state.doc.lineAt(r.from).number !== state.doc.lineAt(r.to).number,
  );
  if (multiLine) return indentMore({ state, dispatch });
  dispatch(state.update(state.replaceSelection("  "), { scrollIntoView: true, userEvent: "input" }));
  return true;
};

/** Shift-Tab: outdent the selected lines by one unit. */
export const outdent: StateCommand = indentLess;
