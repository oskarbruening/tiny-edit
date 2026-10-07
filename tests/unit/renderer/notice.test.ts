import { describe, expect, it, vi } from "vitest";
import { Notice } from "../../../src/renderer/notice";

describe("Notice", () => {
  it("starts hidden and shows a message with action buttons", () => {
    const host = document.createElement("div");
    const notice = new Notice(host);
    expect(notice.visible).toBe(false);
    expect(host.getAttribute("role")).toBe("status");

    const reload = vi.fn();
    notice.show("Changed on disk", [
      { label: "Reload", onClick: reload },
      { label: "Keep mine", onClick: vi.fn() },
    ]);
    expect(notice.visible).toBe(true);
    expect(notice.message).toBe("Changed on disk");
    const buttons = host.querySelectorAll("button");
    expect([...buttons].map((b) => b.textContent)).toEqual(["Reload", "Keep mine"]);
    buttons[0]!.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("hide clears everything; show replaces previous actions", () => {
    const host = document.createElement("div");
    const notice = new Notice(host);
    notice.show("a", [{ label: "x", onClick: vi.fn() }]);
    notice.show("b");
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(notice.message).toBe("b");
    notice.hide();
    expect(notice.visible).toBe(false);
    expect(notice.message).toBe("");
  });
});
