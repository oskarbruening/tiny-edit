import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  hiddenSpans,
  scopeExtension,
  scopeField,
  setScope,
  type ScopeRange,
} from "../../../../src/renderer/editor/scope";

const doc = "line0\nline1\nline2\nline3"; // offsets: 0,6,12,18 (each line is 5 chars + \n)

const make = (text = doc): EditorState => EditorState.create({ doc: text, extensions: [scopeExtension] });
const scope = (state: EditorState, range: ScopeRange | null): EditorState =>
  state.update({ effects: setScope.of(range) }).state;

describe("hiddenSpans", () => {
  it("is empty when unscoped and omits an empty leading or trailing span", () => {
    expect(hiddenSpans(null, 100)).toEqual([]);
    expect(hiddenSpans({ from: 0, to: 100 }, 100)).toEqual([]); // nothing hidden
    expect(hiddenSpans({ from: 6, to: 100 }, 100)).toEqual([[0, 6]]); // only the head
    expect(hiddenSpans({ from: 0, to: 12 }, 100)).toEqual([[12, 100]]); // only the tail
    expect(hiddenSpans({ from: 6, to: 12 }, 100)).toEqual([
      [0, 6],
      [12, 100],
    ]);
  });
});

describe("scopeField", () => {
  it("sets and clears the range", () => {
    const scoped = scope(make(), { from: 6, to: 12 });
    expect(scoped.field(scopeField)).toEqual({ from: 6, to: 12 });
    expect(scope(scoped, null).field(scopeField)).toBeNull();
  });

  it("maps the range through edits, keeping text typed at either boundary inside", () => {
    const scoped = scope(make(), { from: 6, to: 12 }); // the "line1\n" section
    // Insert at the start boundary: the new text belongs to the section, so `from` stays put.
    const atStart = scoped.update({ changes: { from: 6, insert: "XX" } }).state;
    expect(atStart.field(scopeField)).toEqual({ from: 6, to: 14 });
    // Insert at the end boundary: `to` grows to include it.
    const atEnd = scoped.update({ changes: { from: 12, insert: "YY" } }).state;
    expect(atEnd.field(scopeField)).toEqual({ from: 6, to: 14 });
    // A deletion inside shrinks the range.
    const deleted = scoped.update({ changes: { from: 6, to: 9 } }).state;
    expect(deleted.field(scopeField)).toEqual({ from: 6, to: 9 });
  });

  it("clears itself when the section collapses to nothing", () => {
    const scoped = scope(make(), { from: 6, to: 12 });
    const gone = scoped.update({ changes: { from: 6, to: 12 } }).state; // delete the whole section
    expect(gone.field(scopeField)).toBeNull();
  });

  it("clamps a range that exceeds the document", () => {
    const scoped = scope(make("short"), { from: 2, to: 999 });
    expect(scoped.field(scopeField)).toEqual({ from: 2, to: 5 });
  });
});

describe("changeFilter", () => {
  it("suppresses edits to the hidden head and tail, allows edits inside the section", () => {
    const scoped = scope(make(), { from: 6, to: 12 }); // only "line1\n" is editable
    const head = scoped.update({ changes: { from: 0, to: 3 } }).state; // touch the hidden head
    expect(head.doc.toString()).toBe(doc);
    const tail = scoped.update({ changes: { from: 18, insert: "Z" } }).state; // touch the hidden tail
    expect(tail.doc.toString()).toBe(doc);
    const inside = scoped.update({ changes: { from: 6, to: 11, insert: "Z" } }).state; // inside
    expect(inside.doc.toString()).toBe("line0\nZ\nline2\nline3");
  });

  it("allows any edit when unscoped", () => {
    const next = make().update({ changes: { from: 0, to: 23, insert: "x" } }).state;
    expect(next.doc.toString()).toBe("x");
  });
});
