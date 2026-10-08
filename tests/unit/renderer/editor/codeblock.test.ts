import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { buildCodeBlocks } from "../../../../src/renderer/editor/codeblock";
import { editorExtensions } from "../../../../src/renderer/editor/extensions";

const views: EditorView[] = [];
afterEach(() => {
  views.splice(0).forEach((v) => v.destroy());
});

function view(doc: string) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const v = new EditorView({ parent, state: EditorState.create({ doc, extensions: editorExtensions() }) });
  views.push(v);
  return v;
}

function count(v: EditorView, sel: string): number {
  return v.contentDOM.querySelectorAll(sel).length;
}

describe("buildCodeBlocks", () => {
  it("decorates one line per block line in document order", () => {
    const v = view("```js\nf(a)\ng(b)\n```\n");
    expect(buildCodeBlocks(v.state).size).toBe(4);
  });
});

describe("code block background decorations", () => {
  it("marks every line of a fenced block, with first and last carrying the corner classes", () => {
    const v = view("```js\nf(a)\ng(b)\n```\n");
    expect(count(v, ".cm-line.te-codeblock-line")).toBe(4);
    expect(count(v, ".te-codeblock-first")).toBe(1);
    expect(count(v, ".te-codeblock-last")).toBe(1);
    const first = v.contentDOM.querySelector(".te-codeblock-first")!;
    const last = v.contentDOM.querySelector(".te-codeblock-last")!;
    expect(first.textContent).toContain("```js");
    expect(last.textContent).toContain("```");
  });

  it("leaves prose lines untouched and spans both fence lines", () => {
    const v = view("intro text\n\n```\ncode\n```\n");
    const prose = [...v.contentDOM.querySelectorAll(".cm-line")].find((l) =>
      l.textContent?.includes("intro"),
    )!;
    expect(prose.classList.contains("te-codeblock-line")).toBe(false);
    expect(count(v, ".te-codeblock-line")).toBe(3); // ``` + code + ```
  });

  it("covers an unclosed fence through the end of the document", () => {
    const v = view("```\nstill open\n");
    expect(count(v, ".te-codeblock-line")).toBe(2);
    expect(count(v, ".te-codeblock-last")).toBe(1);
  });

  it("gives a lone fence a single all-corners line", () => {
    const v = view("```");
    expect(count(v, ".te-codeblock-line")).toBe(1);
    expect(count(v, ".te-codeblock-first.te-codeblock-last")).toBe(1);
  });

  it("rebuilds as blocks appear and disappear", () => {
    const v = view("plain");
    expect(count(v, ".te-codeblock-line")).toBe(0);
    v.dispatch({ changes: { from: v.state.doc.length, insert: "\n\n```\nx\n```" } });
    expect(count(v, ".te-codeblock-line")).toBe(3);
  });
});
