import { describe, expect, it, vi } from "vitest";
import { hardenWebContents } from "../../../src/main/security";

function fakeContents(currentUrl: string) {
  const handlers = new Map<string, (event: { preventDefault: () => void }, url: string) => void>();
  return {
    handlers,
    contents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, cb: (e: { preventDefault: () => void }, url: string) => void) => {
        handlers.set(event, cb);
      }),
      getURL: () => currentUrl,
    },
  };
}

describe("hardenWebContents", () => {
  it("denies every window.open", () => {
    const { contents } = fakeContents("file:///app/index.html");
    hardenWebContents(contents as never);
    const handler = contents.setWindowOpenHandler.mock.calls[0]![0] as () => { action: string };
    expect(handler()).toEqual({ action: "deny" });
  });

  it("blocks navigation to other URLs but allows a reload of the current one", () => {
    const { contents, handlers } = fakeContents("http://localhost:5173/");
    hardenWebContents(contents as never);
    const willNavigate = handlers.get("will-navigate")!;

    const blocked = { preventDefault: vi.fn() };
    willNavigate(blocked, "file:///Users/me/dropped.md");
    expect(blocked.preventDefault).toHaveBeenCalled();

    const allowed = { preventDefault: vi.fn() };
    willNavigate(allowed, "http://localhost:5173/");
    expect(allowed.preventDefault).not.toHaveBeenCalled();
  });
});
