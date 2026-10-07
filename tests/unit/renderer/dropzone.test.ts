import { describe, expect, it, vi } from "vitest";
import { installDropzone } from "../../../src/renderer/dropzone";

function dragEvent(type: string, types: string[], files: File[] = []) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent & { dataTransfer: unknown };
  Object.defineProperty(e, "dataTransfer", { value: { types, files, dropEffect: "none" } });
  return e as DragEvent;
}

describe("installDropzone", () => {
  it("highlights while files are dragged, opens dropped paths, and prevents navigation", () => {
    const target = new EventTarget() as unknown as Window;
    const onPaths = vi.fn();
    const onDragState = vi.fn();
    const files = [new File(["a"], "a.md"), new File(["b"], "b.md"), new File(["c"], "clip.png")];
    installDropzone(target, {
      pathForFile: (f) => (f.name === "clip.png" ? "" : `/x/${f.name}`),
      onPaths,
      onDragState,
    });

    const enter = dragEvent("dragenter", ["Files"]);
    target.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(onDragState).toHaveBeenLastCalledWith(true);

    target.dispatchEvent(dragEvent("dragenter", ["Files"])); // nested element
    target.dispatchEvent(dragEvent("dragleave", ["Files"]));
    expect(onDragState).toHaveBeenCalledTimes(1); // still inside

    const over = dragEvent("dragover", ["Files"]);
    target.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect((over.dataTransfer as DataTransfer).dropEffect).toBe("copy");

    const drop = dragEvent("drop", ["Files"], files);
    target.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(onPaths).toHaveBeenCalledWith(["/x/a.md", "/x/b.md"]);
    expect(onDragState).toHaveBeenLastCalledWith(false);
  });

  it("ignores drags that carry no files (text, internal reorders) and drops with no disk paths", () => {
    const target = new EventTarget() as unknown as Window;
    const onPaths = vi.fn();
    const onDragState = vi.fn();
    const off = installDropzone(target, { pathForFile: () => "", onPaths, onDragState });
    const text = dragEvent("dragover", ["text/plain"]);
    target.dispatchEvent(text);
    target.dispatchEvent(dragEvent("dragenter", ["text/plain"]));
    target.dispatchEvent(dragEvent("dragleave", ["text/plain"]));
    expect(text.defaultPrevented).toBe(false);
    expect(onDragState).not.toHaveBeenCalled();
    target.dispatchEvent(dragEvent("drop", ["Files"], [new File(["x"], "pasted.png")]));
    expect(onPaths).not.toHaveBeenCalled();
    target.dispatchEvent(dragEvent("dragleave", ["Files"])); // depth never below zero
    off();
    target.dispatchEvent(dragEvent("dragenter", ["Files"]));
    expect(onDragState).toHaveBeenLastCalledWith(false);
  });
});
