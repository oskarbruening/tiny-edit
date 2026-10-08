import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { editingKeymap, editorExtensions } from "../../../../src/renderer/editor/extensions";

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

  it("Backspace removes exactly one character, even inside indentation", () => {
    const v = view("    x", 4); // caret after four spaces
    press(v, "Backspace");
    expect(v.state.doc.toString()).toBe("   x");
    v.destroy();
  });

  it("carries no undocumented editing shortcuts: no comment toggle, line move, line copy or indent keys", () => {
    const keys = new Set(editingKeymap.map((b) => b.key));
    for (const k of [
      "Mod-/",
      "Alt-ArrowUp",
      "Alt-ArrowDown",
      "Shift-Alt-ArrowUp",
      "Mod-]",
      "Mod-[",
      "Mod-Enter",
      "Mod-i",
      "Shift-Mod-k",
      "Mod-Alt-\\",
      "Alt-A",
    ])
      expect(keys.has(k)).toBe(false);
    const v = view("a\nb", 0);
    press(v, "/", { metaKey: true });
    press(v, "ArrowDown", { altKey: true });
    press(v, "]", { metaKey: true });
    press(v, "Enter", { metaKey: true });
    expect(v.state.doc.toString()).toBe("a\nb");
    v.destroy();
  });

  it("splits lines on LF only, so a stray CR stays in the text and a CR-only file is one line", () => {
    const v = view("a\rb\nc");
    expect(v.state.doc.lines).toBe(2);
    expect(v.state.doc.toString()).toBe("a\rb\nc");
    expect(v.contentDOM.querySelector(".cm-specialChar")).not.toBeNull(); // the CR is visible, not lost
    v.destroy();
  });

  it("leaves a dropped file alone: the window opens it, the editor must not paste its contents", () => {
    const v = view("keep me");
    const drop = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, "dataTransfer", {
      value: { files: [new File(["pasted?"], "x.md")], getData: () => "", types: ["Files"] },
    });
    v.contentDOM.dispatchEvent(drop);
    expect(v.state.doc.toString()).toBe("keep me");
    const textDrop = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(textDrop, "dataTransfer", { value: { files: [], getData: () => "", types: [] } });
    v.contentDOM.dispatchEvent(textDrop); // a plain text drag still reaches CodeMirror (no files → not ours)
    expect(v.state.doc.toString()).toBe("keep me");
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
