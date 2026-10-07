import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { insertTwoSpaces, outdent } from "../../../../src/renderer/editor/commands";
import { editorExtensions } from "../../../../src/renderer/editor/extensions";

function run(cmd: typeof insertTwoSpaces, doc: string, anchor: number, head = anchor) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: editorExtensions(),
  });
  const ok = cmd({ state, dispatch: (tr) => (state = tr.state) });
  return { ok, doc: state.doc.toString(), sel: state.selection.main };
}

describe("insertTwoSpaces", () => {
  it("inserts two spaces at the caret, never a tab", () => {
    const r = run(insertTwoSpaces, "ab", 1);
    expect(r).toMatchObject({ ok: true, doc: "a  b" });
    expect(r.sel.head).toBe(3);
    expect(r.doc).not.toContain("\t");
  });
  it("replaces a single-line selection", () => {
    expect(run(insertTwoSpaces, "hello world", 0, 5).doc).toBe("   world");
  });
  it("indents every line of a multi-line selection by one unit", () => {
    expect(run(insertTwoSpaces, "a\nb\nc", 0, 3).doc).toBe("  a\n  b\nc");
  });
});

describe("outdent", () => {
  it("removes one indent unit from selected lines", () => {
    expect(run(outdent, "  a\n    b", 0, 7).doc).toBe("a\n  b");
  });
});
