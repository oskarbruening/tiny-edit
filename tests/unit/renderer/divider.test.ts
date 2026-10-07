import { describe, expect, it, vi } from "vitest";
import { installDivider } from "../../../src/renderer/divider";

function setup(width = 200) {
  const handle = document.createElement("div");
  const win = new EventTarget() as unknown as Window;
  const deps = { getWidth: () => width, onPreview: vi.fn(), onCommit: vi.fn(), min: 120, max: 600 };
  const off = installDivider(handle, win, deps);
  const mouse = (target: EventTarget, type: string, clientX: number, button = 0) =>
    target.dispatchEvent(new MouseEvent(type, { clientX, button, bubbles: true, cancelable: true }));
  return { handle, win, deps, off, mouse };
}

describe("installDivider", () => {
  it("previews while dragging, clamps, and commits once on release", () => {
    const { handle, win, deps, mouse } = setup();
    mouse(handle, "mousedown", 200);
    expect(handle.classList.contains("is-dragging")).toBe(true);
    mouse(win, "mousemove", 250);
    mouse(win, "mousemove", 900);
    mouse(win, "mousemove", -500);
    expect(deps.onPreview.mock.calls.map((c) => c[0])).toEqual([250, 600, 120]);
    mouse(win, "mouseup", 0);
    expect(deps.onCommit).toHaveBeenCalledTimes(1);
    expect(deps.onCommit).toHaveBeenCalledWith(120);
    expect(handle.classList.contains("is-dragging")).toBe(false);
    mouse(win, "mousemove", 300); // released: ignored
    expect(deps.onPreview).toHaveBeenCalledTimes(3);
  });

  it("ignores non-primary buttons and does not commit an unchanged width", () => {
    const { handle, win, deps, mouse } = setup();
    mouse(handle, "mousedown", 200, 2);
    mouse(win, "mousemove", 300);
    expect(deps.onPreview).not.toHaveBeenCalled();
    mouse(handle, "mousedown", 200);
    mouse(win, "mouseup", 200);
    expect(deps.onCommit).not.toHaveBeenCalled();
    mouse(win, "mouseup", 200); // idle: ignored
  });

  it("uninstall stops a drag in progress and detaches", () => {
    const { handle, win, deps, off, mouse } = setup();
    mouse(handle, "mousedown", 200);
    mouse(win, "mousemove", 260);
    off();
    expect(deps.onCommit).toHaveBeenCalledWith(260);
    mouse(handle, "mousedown", 200);
    mouse(win, "mousemove", 400);
    expect(deps.onPreview).toHaveBeenCalledTimes(1);
  });
});
