import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import { editorExtensions } from "../../../../src/renderer/editor/extensions";
import { fenceCompletion, insideFencedCode } from "../../../../src/renderer/editor/fence";

function state(doc: string, anchor = doc.length, head = anchor): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: editorExtensions(),
  });
}

/** Applies `text` typed at the caret the way CodeMirror would: through the input handlers, else as plain insertion. */
function type(s: EditorState, text: string): EditorState {
  const from = s.selection.main.from;
  const to = s.selection.main.to;
  const spec = fenceCompletion(s, from, to, text);
  return s.update(spec ?? { changes: { from, to, insert: text }, selection: { anchor: from + text.length } })
    .state;
}

describe("fenceCompletion", () => {
  it("typing the third backtick on an empty line adds the closing fence below and keeps the caret after the opening one", () => {
    const s = type(state("``"), "`");
    expect(s.doc.toString()).toBe("```\n```");
    expect(s.selection.main.head).toBe(3);
  });

  it("the closing fence copies the opening line's leading whitespace", () => {
    const s = type(state("- item\n  ``"), "`");
    expect(s.doc.toString()).toBe("- item\n  ```\n  ```");
    expect(s.selection.main.head).toBe("- item\n  ```".length);
  });

  it("the info string can be typed straight after and Enter lands inside the block", () => {
    let s = type(state("intro\n\n``"), "`");
    for (const ch of "ts") s = type(s, ch);
    expect(s.doc.toString()).toBe("intro\n\n```ts\n```");
    expect(s.selection.main.head).toBe("intro\n\n```ts".length);
  });

  it("closing a fence by hand inside an open block adds nothing", () => {
    expect(fenceCompletion(state("```js\nconst a = 1;\n``"), 20, 20, "`")).toBeNull();
    const s = type(state("```js\nconst a = 1;\n``"), "`");
    expect(s.doc.toString()).toBe("```js\nconst a = 1;\n```");
  });

  it("a new fence after a closed block is completed again, even on the very next line", () => {
    const doc = "```\nx\n```\n\n``";
    expect(type(state(doc), "`").doc.toString()).toBe("```\nx\n```\n\n```\n```");
    const adjacent = "```\nx\n```\n``";
    expect(type(state(adjacent), "`").doc.toString()).toBe("```\nx\n```\n```\n```");
  });

  it("does nothing for a plain backtick, a second backtick or a backtick after other text", () => {
    expect(fenceCompletion(state(""), 0, 0, "`")).toBeNull();
    expect(fenceCompletion(state("`"), 1, 1, "`")).toBeNull();
    expect(fenceCompletion(state("a``"), 3, 3, "`")).toBeNull();
    expect(fenceCompletion(state("````"), 4, 4, "`")).toBeNull();
  });

  it("does nothing when the caret is not at the end of the line, for other text, or in a code span", () => {
    expect(fenceCompletion(state("`` tail", 2), 2, 2, "`")).toBeNull();
    expect(fenceCompletion(state("``"), 2, 2, "x")).toBeNull();
    expect(fenceCompletion(state("``"), 2, 2, "``")).toBeNull();
  });

  it("does nothing when text is selected or when there is more than one cursor", () => {
    expect(fenceCompletion(state("``", 0, 2), 0, 2, "`")).toBeNull();
    const multi = EditorState.create({
      doc: "``\n``",
      selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(5)]),
      extensions: editorExtensions(),
    });
    expect(fenceCompletion(multi, 2, 2, "`")).toBeNull();
    // The input must be at the (single) caret, not somewhere else in the document.
    expect(fenceCompletion(state("``\ntext", 5), 2, 2, "`")).toBeNull();
  });

  it("is one undo step: Cmd+Z removes the closing fence together with the typed backtick", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({ parent, state: state("``") });
    const handlers = view.state.facet(EditorView.inputHandler);
    const insert = () => view.state.update({ changes: { from: 2, insert: "`" } });
    expect(handlers.some((h) => h(view, 2, 2, "`", insert))).toBe(true);
    expect(view.state.doc.toString()).toBe("```\n```");
    undo(view);
    expect(view.state.doc.toString()).toBe("``");
    // Anything else falls through to CodeMirror's default insertion.
    expect(handlers.some((h) => h(view, 2, 2, "x", insert))).toBe(false);
    view.destroy();
  });
});

describe("insideFencedCode", () => {
  it("is true inside open and closed blocks and false in prose", () => {
    const closed = state("```\ncode\n```\nafter");
    expect(insideFencedCode(closed, 5)).toBe(true);
    expect(insideFencedCode(closed, closed.doc.length)).toBe(false);
    // The line right after the closing fence is outside the block (its node ends at that line's start).
    expect(insideFencedCode(closed, "```\ncode\n```\n".length)).toBe(false);
    expect(insideFencedCode(closed, "```\ncode\n```".length)).toBe(true);
    const open = state("```\ncode");
    expect(insideFencedCode(open, open.doc.length)).toBe(true);
    expect(insideFencedCode(state("plain"), 3)).toBe(false);
  });
});
