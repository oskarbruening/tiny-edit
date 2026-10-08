import { afterEach, describe, expect, it, vi } from "vitest";
import { undo, undoDepth } from "@codemirror/commands";
import { Editor, minimalChange } from "../../../../src/renderer/editor/editor";

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

  it("replaceText applies the disk text as one minimal change: caret, scope and undo history map through it", () => {
    const { editor, hooks } = make();
    editors.push(editor);
    editor.open("/a.md", "one\ntwo\nthree", { anchor: 9, head: 9, scrollTop: 0 }); // caret in "three"
    editor.view.dispatch({ changes: { from: 13, insert: "!" } }); // a user edit → undo history
    expect(undoDepth(editor.view.state)).toBe(1);
    hooks.onDocChange.mockClear();
    editor.applyScope("/a.md", { from: 8, to: 14 });
    editor.view.dispatch({ selection: { anchor: 10 } });

    editor.replaceText("/a.md", "ONE\ntwo\nthree!"); // the first line changed on disk
    expect(editor.view.state.doc.toString()).toBe("ONE\ntwo\nthree!");
    expect(editor.view.state.selection.main.head).toBe(10); // same text, same place
    expect(editor.scopeOf("/a.md")).toEqual({ from: 8, to: 14 }); // the hidden head was changed; scope survived
    expect(undoDepth(editor.view.state)).toBe(1); // history kept …
    expect(hooks.onDocChange).not.toHaveBeenCalled(); // … and autosave not told
    undo(editor.view);
    expect(editor.view.state.doc.toString()).toBe("ONE\ntwo\nthree"); // … and still undoes the user's edit
    expect(hooks.onDocChange).toHaveBeenCalledTimes(1); // undo is the user's own edit
    hooks.onDocChange.mockClear();

    editor.replaceText("/a.md", editor.text("/a.md")!); // identical text: nothing happens
    expect(hooks.onDocChange).not.toHaveBeenCalled();

    editor.open("/b.md", "b");
    editor.replaceText("/a.md", "zz");
    expect(editor.text("/a.md")).toBe("zz");
    editor.replaceText("/unknown.md", "ignored");
    expect(editor.text("/unknown.md")).toBeNull();
  });

  it("formatDocument replaces the active file as one undoable edit that triggers autosave", () => {
    const { editor, hooks } = make();
    editors.push(editor);
    editor.open("/a.json", '{"a":1}');
    hooks.onDocChange.mockClear();
    expect(editor.formatDocument("/a.json", '{ "a": 1 }\n')).toBe(true);
    expect(editor.text("/a.json")).toBe('{ "a": 1 }\n');
    expect(hooks.onDocChange).toHaveBeenCalledWith("/a.json"); // a real user edit → autosave
    undo(editor.view);
    expect(editor.text("/a.json")).toBe('{"a":1}'); // Cmd+Z reverts the format

    expect(editor.formatDocument("/a.json", editor.text("/a.json")!)).toBe(false); // already formatted → no-op
    expect(editor.formatDocument("/other.json", "x")).toBe(false); // not the active file → ignored
  });

  it("formatDocument clears a section scope so the whole file is reformatted", () => {
    const { editor } = make();
    editors.push(editor);
    editor.open("/a.json", "line0\nline1\nline2");
    editor.applyScope("/a.json", { from: 6, to: 11 });
    expect(editor.scopeOf("/a.json")).not.toBeNull();
    expect(editor.formatDocument("/a.json", "WHOLE")).toBe(true);
    expect(editor.scopeOf("/a.json")).toBeNull();
    expect(editor.text("/a.json")).toBe("WHOLE");
  });

  it("minimalChange trims the common prefix and suffix", () => {
    expect(minimalChange("abc", "abc")).toBeNull();
    expect(minimalChange("hello world", "hello there world")).toEqual({ from: 6, to: 6, insert: "there " });
    expect(minimalChange("aXb", "ab")).toEqual({ from: 1, to: 2, insert: "" });
    expect(minimalChange("aa", "aaa")).toEqual({ from: 2, to: 2, insert: "a" });
    expect(minimalChange("", "x")).toEqual({ from: 0, to: 0, insert: "x" });
    expect(minimalChange("x", "")).toEqual({ from: 0, to: 1, insert: "" });
  });

  it("restores each open file's own scroll position when switching back, and after a page", () => {
    const { editor } = make();
    editors.push(editor);
    editor.open("/a.md", "a\n".repeat(200), { anchor: 0, head: 0, scrollTop: 0 });
    editor.view.scrollDOM.scrollTop = 120;
    editor.open("/b.md", "b\n".repeat(200), { anchor: 0, head: 0, scrollTop: 40 });
    const tops: number[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      tops.push(editor.view.scrollDOM.scrollTop);
      return 1;
    });
    editor.open("/a.md", "stale"); // already open → its own last scroll offset, not the saved one
    expect(tops.at(-1)).toBe(120);
    editor.view.scrollDOM.scrollTop = 77;
    editor.showPage("# page");
    editor.open("/a.md", "stale");
    expect(tops.at(-1)).toBe(77);
    editor.open("/b.md", "stale"); // b was parked at whatever the scroller held when we left it
    editor.open("/c.md", "fresh", { anchor: 0, head: 0, scrollTop: 33 }); // never open → the saved offset
    expect(tops.at(-1)).toBe(33);
    raf.mockRestore();
  });

  it("opens a file read-only when asked: no typing, no doc-change hook, still navigable", () => {
    const { editor, hooks } = make();
    editors.push(editor);
    editor.open("/bad.txt", "caf\uFFFD", undefined, { readOnly: true });
    expect(editor.view.state.readOnly).toBe(true);
    expect(editor.view.contentDOM.getAttribute("contenteditable")).toBe("false");
    editor.view.dispatch(editor.view.state.replaceSelection("x")); // commands refuse; a raw dispatch still goes through
    expect(hooks.onDocChange).toHaveBeenCalledTimes(1);
    editor.open("/ok.md", "fine");
    expect(editor.view.state.readOnly).toBe(false);
    expect(editor.view.contentDOM.getAttribute("contenteditable")).toBe("true");
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
