import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "../../../../src/renderer/editor/editor";

function make(debounce = 10) {
  const host = document.createElement("div");
  document.body.append(host);
  const hooks = { onViewChange: vi.fn(), onDocChange: vi.fn() };
  // autoFocus off: happy-dom fires selectionchange synchronously inside CodeMirror's own update, which a real browser never does.
  const editor = new Editor(host, { hooks, viewDebounceMs: debounce, autoFocus: false });
  return { host, hooks, editor };
}

const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  vi.useRealTimers();
});

describe("Editor", () => {
  it("shows the placeholder page read-only; showPage keeps the active file's state for reopening", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const hooks = { onViewChange: vi.fn(), onDocChange: vi.fn() };
    const editor = new Editor(host, { hooks, autoFocus: false, placeholder: "# Hi" });
    editors.push(editor);
    expect(editor.view.state.doc.toString()).toBe("# Hi");
    expect(editor.view.state.readOnly).toBe(true);
    editor.open("/a.md", "aaa");
    editor.view.dispatch({ changes: { from: 3, insert: "!" }, selection: { anchor: 4 } });
    hooks.onDocChange.mockClear();
    editor.showPage("# Page");
    expect(editor.currentPath).toBeNull();
    expect(editor.view.state.doc.toString()).toBe("# Page");
    expect(editor.view.state.readOnly).toBe(true);
    expect(hooks.onViewChange).toHaveBeenLastCalledWith("/a.md", expect.objectContaining({ anchor: 4 }));
    expect(editor.text("/a.md")).toBe("aaa!");
    editor.open("/a.md", "stale");
    expect(editor.view.state.doc.toString()).toBe("aaa!");
    editor.close("/a.md");
    expect(editor.view.state.doc.toString()).toBe("# Hi");
    expect(hooks.onDocChange).not.toHaveBeenCalled();
  });

  it("starts blank and read-only, opens a file with the saved caret clamped", () => {
    const { editor } = make();
    editors.push(editor);
    expect(editor.currentPath).toBeNull();
    expect(editor.view.state.doc.toString()).toBe("");
    editor.open("/a.md", "hello", { anchor: 2, head: 999, scrollTop: 0 });
    expect(editor.currentPath).toBe("/a.md");
    expect(editor.view.state.doc.toString()).toBe("hello");
    expect(editor.view.state.selection.main).toMatchObject({ anchor: 2, head: 5 });
    expect(editor.isOpen("/a.md")).toBe(true);
    expect(editor.text("/a.md")).toBe("hello");
    expect(editor.text("/nope.md")).toBeNull();
  });

  it("keeps per-file edits and undo history across switches", () => {
    const { editor, hooks } = make();
    editors.push(editor);
    editor.open("/a.md", "aaa");
    editor.view.dispatch({ changes: { from: 3, insert: "!" } });
    expect(hooks.onDocChange).toHaveBeenCalledWith("/a.md");
    editor.open("/b.md", "bbb");
    expect(editor.view.state.doc.toString()).toBe("bbb");
    expect(editor.text("/a.md")).toBe("aaa!");
    editor.open("/a.md", "stale text from disk is ignored because the file is still open");
    expect(editor.view.state.doc.toString()).toBe("aaa!");
  });

  it("reports caret/scroll after the debounce and immediately on switch", () => {
    vi.useFakeTimers();
    const { editor, hooks } = make(300);
    editors.push(editor);
    editor.open("/a.md", "hello");
    editor.view.dispatch({ selection: { anchor: 2 } });
    vi.advanceTimersByTime(200);
    editor.view.dispatch({ selection: { anchor: 1, head: 3 } }); // resets the debounce
    vi.advanceTimersByTime(200);
    expect(hooks.onViewChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(hooks.onViewChange).toHaveBeenCalledWith("/a.md", { anchor: 1, head: 3, scrollTop: 0 });
    editor.view.dispatch({ selection: { anchor: 4 } });
    editor.open("/b.md", "x");
    expect(hooks.onViewChange).toHaveBeenLastCalledWith("/a.md", { anchor: 4, head: 4, scrollTop: 0 });
    editor.view.scrollDOM.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(300);
    expect(hooks.onViewChange).toHaveBeenLastCalledWith("/b.md", expect.objectContaining({ anchor: 0 }));
  });

  it("replaceText swaps the document keeping a clamped caret, for active and background files", () => {
    const { editor } = make();
    editors.push(editor);
    editor.open("/a.md", "0123456789", { anchor: 8, head: 8, scrollTop: 0 });
    editor.replaceText("/a.md", "abc");
    expect(editor.view.state.doc.toString()).toBe("abc");
    expect(editor.view.state.selection.main.head).toBe(3);
    editor.open("/b.md", "b");
    editor.replaceText("/a.md", "zz");
    expect(editor.text("/a.md")).toBe("zz");
    editor.replaceText("/unknown.md", "ignored");
    expect(editor.text("/unknown.md")).toBeNull();
  });

  it("close forgets a file and blanks the view when it was active", () => {
    const { editor } = make();
    editors.push(editor);
    editor.open("/a.md", "a");
    editor.open("/b.md", "b");
    editor.close("/a.md");
    expect(editor.isOpen("/a.md")).toBe(false);
    expect(editor.currentPath).toBe("/b.md");
    editor.close("/b.md");
    expect(editor.currentPath).toBeNull();
    expect(editor.view.state.doc.toString()).toBe("");
    expect(editor.currentView()).toEqual({ anchor: 0, head: 0, scrollTop: 0 });
  });

  it("focuses the editor after opening by default", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new Editor(host, { hooks: { onViewChange: vi.fn(), onDocChange: vi.fn() } });
    editors.push(editor);
    const focus = vi.spyOn(editor.view, "focus").mockImplementation(() => undefined);
    editor.open("/a.md", "hello");
    vi.advanceTimersByTime(50);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("destroy cancels a pending report", () => {
    vi.useFakeTimers();
    const { editor, hooks } = make(300);
    editor.open("/a.md", "hello");
    editor.view.dispatch({ selection: { anchor: 2 } });
    editor.destroy();
    vi.advanceTimersByTime(1000);
    expect(hooks.onViewChange).not.toHaveBeenCalled();
  });

  it("applyScope narrows the active file and clears it, ignoring background and empty ranges", () => {
    const { editor } = make();
    editors.push(editor);
    editor.open("/a.md", "line0\nline1\nline2");
    editor.applyScope("/a.md", { from: 6, to: 12 });
    expect(editor.scopeOf("/a.md")).toEqual({ from: 6, to: 12 });
    expect(editor.view.state.selection.main.head).toBe(6); // caret moved to the section start
    expect(editor.text("/a.md")).toBe("line0\nline1\nline2"); // whole file still in the buffer
    editor.applyScope("/a.md", null);
    expect(editor.scopeOf("/a.md")).toBeNull();
    editor.applyScope("/a.md", { from: 5, to: 5 }); // empty range → no scope
    expect(editor.scopeOf("/a.md")).toBeNull();
    editor.applyScope("/b.md", { from: 0, to: 1 }); // not the active file → ignored
    expect(editor.scopeOf("/b.md")).toBeNull();
  });

  it("does not steal focus from another form control when a file finishes opening", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    const field = document.createElement("input");
    document.body.append(host, field);
    const editor = new Editor(host, { hooks: { onViewChange: vi.fn(), onDocChange: vi.fn() } });
    editors.push(editor);
    const focus = vi.spyOn(editor.view, "focus").mockImplementation(() => undefined);
    field.focus();
    editor.open("/a.md", "hello");
    vi.advanceTimersByTime(50);
    expect(focus).not.toHaveBeenCalled();
    field.blur();
    editor.open("/b.md", "x");
    vi.advanceTimersByTime(50);
    expect(focus).toHaveBeenCalledTimes(1);
    field.remove();
  });
});
