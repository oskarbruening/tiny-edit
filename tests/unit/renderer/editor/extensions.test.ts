import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { editorExtensions } from "../../../../src/renderer/editor/extensions";

function view(doc: string, pos = doc.length) {
  const parent = document.createElement("div");
  document.body.append(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(pos),
      extensions: editorExtensions(),
    }),
  });
}

function press(v: EditorView, key: string, init: KeyboardEventInit = {}) {
  v.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}

describe("editorExtensions", () => {
  it("content element refuses every automatic correction", () => {
    const v = view("x");
    expect(v.contentDOM.getAttribute("spellcheck")).toBe("false");
    expect(v.contentDOM.getAttribute("autocorrect")).toBe("off");
    expect(v.contentDOM.getAttribute("autocapitalize")).toBe("off");
    v.destroy();
  });

  it("Enter keeps the previous line's indentation, nothing more (no list continuation)", () => {
    const v = view("  - item");
    press(v, "Enter");
    expect(v.state.doc.toString()).toBe("  - item\n  ");
    v.destroy();
  });

  it("Tab inserts two spaces; Shift-Tab outdents", () => {
    const v = view("a", 1);
    press(v, "Tab");
    expect(v.state.doc.toString()).toBe("a  ");
    press(v, "Tab", { shiftKey: true });
    expect(v.state.doc.toString()).toBe("a  ");
    v.destroy();
  });

  it("typing a quote or bracket inserts exactly that character", () => {
    const v = view("");
    v.dispatch(v.state.replaceSelection('"'));
    v.dispatch(v.state.replaceSelection("("));
    v.dispatch(v.state.replaceSelection("'"));
    expect(v.state.doc.toString()).toBe("\"('");
    v.destroy();
  });

  it("wraps lines, allows multiple selections, and parses markdown", () => {
    const v = view("# Heading\n\n**bold**");
    expect(v.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
    expect(v.state.facet(EditorState.allowMultipleSelections)).toBe(true);
    expect(v.contentDOM.querySelectorAll("span").length).toBeGreaterThan(0);
    v.destroy();
  });

  it("highlights markdown with te-* classes and keeps every marker in the text", () => {
    const doc =
      "# Heading\n\nSome **strong** and *em* with `code` and [link](http://x.y)\n\n> quote\n\n- item\n\n---\n";
    const v = view(doc);
    const classes = (sel: string) =>
      [...v.contentDOM.querySelectorAll(sel)].map((n) => n.textContent).join("");
    expect(classes(".te-heading")).toContain("Heading");
    expect(classes(".te-strong")).toBe("**strong**");
    expect(classes(".te-emphasis")).toBe("*em*");
    expect(classes(".te-inline-code")).toBe("code");
    expect(classes(".te-marker")).toContain("`");
    expect(classes(".te-link")).toContain("link");
    expect(classes(".te-url")).toBe("http://x.y");
    expect(classes(".te-quote")).toContain(">");
    expect(classes(".te-list-marker")).toBe("-");
    expect(classes(".te-hr")).toBe("---");
    expect(v.contentDOM.textContent).toContain("# Heading");
    expect(v.contentDOM.textContent).toContain("**strong**");
    expect(v.contentDOM.textContent).toContain("[link](http://x.y)");
    v.destroy();
  });

  it("makes the scroller scrollable (overflow auto) so long documents scroll inside the host", () => {
    const v = view("x");
    const rule = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
    expect(rule).toMatch(/\.cm-scroller\s*\{[^}]*overflow:\s*auto/);
    v.destroy();
  });
});
