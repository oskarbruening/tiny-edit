import { Annotation, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/** A visible character range [from, to). The rest of the document is hidden but still in the buffer. */
export type ScopeRange = { from: number; to: number };

/** Narrow to a range (hide the rest) or clear the scope with `null`. */
export const setScope = StateEffect.define<ScopeRange | null>();

/**
 * Marks a transaction that replaces the document with the disk version (external change,
 * conflict "Reload"). It is not a user edit: autosave ignores it and the scope's change filter
 * lets it through, since it must be allowed to touch hidden text.
 */
export const externalReload = Annotation.define<boolean>();

/**
 * The [from, to) spans that are hidden for a scope over a document of `length`.
 * Empty when unscoped. Pure, so the decoration set and the atomic ranges share it and it is testable.
 */
export function hiddenSpans(range: ScopeRange | null, length: number): Array<[number, number]> {
  if (!range) return [];
  const spans: Array<[number, number]> = [];
  if (range.from > 0) spans.push([0, range.from]);
  if (range.to < length) spans.push([range.to, length]);
  return spans;
}

/** Replace a hidden span with nothing — the lines collapse but the text stays in the document. */
const hidden = Decoration.replace({});

function hiddenSet(range: ScopeRange | null, length: number): DecorationSet {
  return Decoration.set(
    hiddenSpans(range, length).map(([from, to]) => hidden.range(from, to)),
    true,
  );
}

/**
 * Holds the scoped range and maps it through edits. `from` biases left and `to` biases right so
 * that text typed at either boundary stays inside the visible section. The scope clears itself if
 * the section collapses to nothing (e.g. the whole section was deleted).
 */
export const scopeField = StateField.define<ScopeRange | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setScope)) value = effect.value;
    if (!value) return null;
    if (tr.docChanged)
      value = { from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1) };
    const length = tr.state.doc.length;
    const from = Math.max(0, Math.min(value.from, length));
    const to = Math.max(0, Math.min(value.to, length));
    return from < to ? { from, to } : null;
  },
});

/**
 * Narrow-to-section support. Hides everything outside the scoped range, keeps the caret from
 * entering the hidden text, and rejects edits that would touch it — the full document is always
 * in the buffer, so autosave still writes the whole file.
 */
export const scopeExtension: Extension = [
  scopeField,
  EditorView.decorations.compute([scopeField], (state) =>
    hiddenSet(state.field(scopeField), state.doc.length),
  ),
  EditorView.atomicRanges.of((view) => hiddenSet(view.state.field(scopeField), view.state.doc.length)),
  // changeFilter returns the ranges to *protect*: the hidden head and tail. Edits inside the
  // visible section are allowed; anything touching the hidden text is suppressed.
  EditorState.changeFilter.of((tr) => {
    const range = tr.startState.field(scopeField);
    if (!range || tr.annotation(externalReload)) return true;
    const protect = hiddenSpans(range, tr.startState.doc.length).flat();
    return protect.length ? protect : true;
  }),
];
