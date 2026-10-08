import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { EditorView, type ViewPlugin } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCopy,
  copyButtons,
  type CopyFn,
  fencedBlock,
  inlineCodeInner,
} from "../../../../src/renderer/editor/copy";
import { editorExtensions } from "../../../../src/renderer/editor/extensions";

const views: EditorView[] = [];
afterEach(() => {
  views.splice(0).forEach((v) => v.destroy());
  vi.useRealTimers();
});

function view(doc: string, copy: CopyFn = () => undefined) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const plugin = copyButtons(copy);
  const v = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: editorExtensions([plugin]) }),
  });
  views.push(v);
  return { v, plugin };
}

function nodeNamed(state: EditorState, name: string): SyntaxNode {
  let found: SyntaxNode | null = null;
  syntaxTree(state).iterate({
    enter(n) {
      if (!found && n.name === name) found = n.node;
    },
  });
  if (!found) throw new Error(`no ${name} node`);
  return found;
}

function fire(el: Element, type: string) {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
}

describe("inlineCodeInner", () => {
  it("returns the span between the backtick marks", () => {
    const { v } = view("a `inline code` b");
    const inner = inlineCodeInner(nodeNamed(v.state, "InlineCode"))!;
    expect(v.state.doc.sliceString(inner.from, inner.to)).toBe("inline code");
  });
  it("handles multi-backtick spans", () => {
    const { v } = view("a ``has ` tick`` b");
    const inner = inlineCodeInner(nodeNamed(v.state, "InlineCode"))!;
    expect(v.state.doc.sliceString(inner.from, inner.to)).toBe("has ` tick");
  });
  it("returns null for a backtick run with no inner text", () => {
    // Fabricate a mark-less, zero-width node; the parser never yields one, but the guard must hold.
    const fake = { from: 5, to: 6, getChildren: () => [] } as unknown as SyntaxNode;
    expect(inlineCodeInner(fake)).toBeNull();
  });
});

describe("fencedBlock", () => {
  it("covers the body of a closed fence and keeps the opening line", () => {
    const { v } = view("```js\nf(a)\ng(b)\n```\n");
    const fb = fencedBlock(v.state, nodeNamed(v.state, "FencedCode"))!;
    expect(v.state.doc.sliceString(fb.bodyFrom, fb.bodyTo)).toBe("f(a)\ng(b)");
    expect(v.state.doc.sliceString(fb.lineFrom, fb.lineTo)).toBe("```js");
  });
  it("covers the body of an unclosed fence through the end", () => {
    const { v } = view("```\nopen(\n");
    const fb = fencedBlock(v.state, nodeNamed(v.state, "FencedCode"))!;
    expect(v.state.doc.sliceString(fb.bodyFrom, fb.bodyTo)).toBe("open(\n");
  });
  it("returns null for a fence with no newline", () => {
    const { v } = view("```");
    expect(fencedBlock(v.state, nodeNamed(v.state, "FencedCode"))).toBeNull();
  });
});

describe("buildCopy", () => {
  it("adds one inline widget per code span and one block widget + line per fence", () => {
    const { v } = view("`x` and `y`\n\n```\ncode\n```\n");
    const copy = vi.fn();
    const { decorations, blocks } = buildCopy(v.state, copy);
    let widgets = 0;
    let lines = 0;
    const iter = decorations.iter();
    while (iter.value) {
      if ((iter.value.spec as { widget?: unknown }).widget) widgets++;
      else lines++;
      iter.next();
    }
    expect(widgets).toBe(3); // two inline, one block
    expect(lines).toBe(1); // the opening fence line decoration
    expect(blocks).toHaveLength(1);
  });
});

describe("copyButtons rendering", () => {
  it("renders a hover copy button after each inline code span", () => {
    const { v } = view("a `inline code` b");
    const btn = v.contentDOM.querySelector<HTMLButtonElement>(".te-copy-inline")!;
    expect(btn).toBeTruthy();
    expect(btn.closest(".te-copy-anchor")).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toBe("Copy code");
  });

  it("copies the inner text of an inline span on click", () => {
    const copy = vi.fn();
    const { v } = view("a `inline code` b", copy);
    v.contentDOM.querySelector<HTMLButtonElement>(".te-copy-inline")!.click();
    expect(copy).toHaveBeenCalledWith("inline code");
  });

  it("renders a block button in the opening fence line and copies the body", () => {
    const copy = vi.fn();
    const { v } = view("```js\nf(a)\ng(b)\n```\n", copy);
    const fenceLine = v.contentDOM.querySelector(".cm-line.te-copyblock")!;
    const btn = fenceLine.querySelector<HTMLButtonElement>(".te-copy-block")!;
    expect(btn.getAttribute("aria-label")).toBe("Copy code block");
    btn.click();
    expect(copy).toHaveBeenCalledWith("f(a)\ng(b)");
  });

  it("rebuilds decorations as the document changes", () => {
    const { v } = view("`x`");
    expect(v.contentDOM.querySelectorAll(".te-copy-inline")).toHaveLength(1);
    v.dispatch({ changes: { from: 3, insert: " `y`" } });
    expect(v.contentDOM.querySelectorAll(".te-copy-inline")).toHaveLength(2);
  });
});

describe("copy feedback", () => {
  it("shows a tick then reverts to the copy glyph", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { v } = view("a `code` b");
    const btn = v.contentDOM.querySelector<HTMLButtonElement>(".te-copy-inline")!;
    btn.click();
    expect(btn.classList.contains("is-copied")).toBe(true);
    expect(btn.querySelector("rect")).toBeNull(); // the tick icon has no rect
    btn.click(); // a second copy resets the running timer
    vi.advanceTimersByTime(1101);
    expect(btn.classList.contains("is-copied")).toBe(false);
    expect(btn.querySelector("rect")).toBeTruthy(); // back to the copy icon
  });
});

describe("block hover reveal", () => {
  function lineWith(v: EditorView, text: string): Element {
    const line = [...v.contentDOM.querySelectorAll(".cm-line")].find((l) => l.textContent?.includes(text));
    if (!line) throw new Error(`no line containing ${text}`);
    return line;
  }

  it("reveals the block button while a block line is hovered and hides it otherwise", () => {
    const { v } = view("intro `x` here\n\n```js\nf(a)\n```\n");
    const btn = v.contentDOM.querySelector<HTMLElement>(".te-copy-block")!;
    expect(btn.classList.contains("is-visible")).toBe(false);

    fire(lineWith(v, "f(a)"), "mouseover");
    expect(btn.classList.contains("is-visible")).toBe(true);

    fire(lineWith(v, "intro"), "mouseover"); // a prose line → hide again
    expect(btn.classList.contains("is-visible")).toBe(false);
  });

  it("clears the reveal when the pointer leaves the editor", () => {
    const { v } = view("```\nf(a)\n```\n");
    const btn = v.contentDOM.querySelector<HTMLElement>(".te-copy-block")!;
    fire(lineWith(v, "f(a)"), "mouseover");
    expect(btn.classList.contains("is-visible")).toBe(true);
    v.contentDOM.dispatchEvent(new MouseEvent("mouseleave"));
    expect(btn.classList.contains("is-visible")).toBe(false);
  });

  it("ignores hovers it cannot resolve to a document position", () => {
    const { v, plugin } = view("```\nf(a)\n```\n");
    const instance = v.plugin(plugin as unknown as ViewPlugin<{ onHover(e: Event, v: EditorView): void }>)!;
    const detached = document.createElement("div");
    detached.className = "cm-line";
    expect(() => instance.onHover({ target: detached } as unknown as Event, v)).not.toThrow();
  });
});

describe("buildCopy with ranges", () => {
  it("builds buttons only for code touching the given ranges", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const doc = "`one`\n\nplain\n\n`two`\n";
    const v = new EditorView({ parent, state: EditorState.create({ doc, extensions: editorExtensions() }) });
    try {
      expect(buildCopy(v.state, () => undefined).decorations.size).toBe(2);
      expect(buildCopy(v.state, () => undefined, [{ from: 0, to: 5 }]).decorations.size).toBe(1);
      expect(buildCopy(v.state, () => undefined, [{ from: 7, to: 12 }]).decorations.size).toBe(0);
      expect(
        buildCopy(v.state, () => undefined, [
          { from: 0, to: 2 },
          { from: 3, to: 5 },
        ]).decorations.size,
      ).toBe(1); // overlapping ranges do not duplicate
    } finally {
      v.destroy();
    }
  });
});
