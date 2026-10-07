import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { editorExtensions } from "../../../../src/renderer/editor/extensions";
import { bracketDecorations, fencedCodeRanges } from "../../../../src/renderer/editor/rainbow";

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((v) => v.destroy()));

function view(doc: string) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const v = new EditorView({ parent, state: EditorState.create({ doc, extensions: editorExtensions() }) });
  views.push(v);
  return v;
}

function classesAt(v: EditorView) {
  const out: [string, string][] = [];
  const iter = bracketDecorations(v).iter();
  while (iter.value) {
    out.push([v.state.doc.sliceString(iter.from, iter.to), (iter.value.spec as { class: string }).class]);
    iter.next();
  }
  return out;
}

describe("fencedCodeRanges", () => {
  it("covers the body between the fence lines, for closed and unclosed fences", () => {
    const doc = "intro\n```js\nf(a)\n```\ntail\n```\nopen(\n";
    const v = view(doc);
    const ranges = fencedCodeRanges(v).map((r) => v.state.doc.sliceString(r.from, r.to));
    expect(ranges).toEqual(["f(a)", "open(\n"]);
  });
  it("ignores a fence with no body", () => {
    expect(fencedCodeRanges(view("```"))).toEqual([]);
  });
});

describe("bracketDecorations", () => {
  it("colours nested brackets in code only, cycling through three classes", () => {
    const v = view("(prose) [stays] {plain}\n\n```\na(b[c{d}e]f)\n```\n");
    expect(classesAt(v)).toEqual([
      ["(", "te-bracket-1"],
      ["[", "te-bracket-2"],
      ["{", "te-bracket-3"],
      ["}", "te-bracket-3"],
      ["]", "te-bracket-2"],
      [")", "te-bracket-1"],
    ]);
  });
  it("wraps past three levels and never goes below depth zero", () => {
    const v = view("```\n((((x))))\n)(\n```\n");
    const classes = classesAt(v).map(([, c]) => c);
    expect(classes.slice(0, 4)).toEqual(["te-bracket-1", "te-bracket-2", "te-bracket-3", "te-bracket-1"]);
    expect(classes.at(-2)).toBe("te-bracket-1"); // the stray ')' at depth 0
    expect(classes.at(-1)).toBe("te-bracket-1");
  });
  it("is live: decorations appear in the DOM and update on edits", () => {
    const v = view("```\n()\n```\n");
    expect(v.contentDOM.querySelectorAll(".te-bracket-1")).toHaveLength(2);
    v.dispatch({ changes: { from: 4, insert: "[" } });
    expect(v.contentDOM.querySelectorAll(".te-bracket-1")).toHaveLength(1);
    expect(v.contentDOM.querySelectorAll(".te-bracket-2")).toHaveLength(2);
  });
});
