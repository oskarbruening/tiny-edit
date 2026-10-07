import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACKGROUND,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_WINDOW,
  MIN_WINDOW,
} from "../../../src/shared/constants";

describe("constants", () => {
  it("window is the 750 px editor plus the 200 px sidebar", () => {
    expect(DEFAULT_SIDEBAR_WIDTH).toBe(200);
    expect(DEFAULT_WINDOW).toEqual({ width: 950, height: 500 });
    expect(MIN_WINDOW.width).toBeLessThan(DEFAULT_WINDOW.width);
  });
  it("background is a 6-digit hex colour", () => {
    expect(DEFAULT_BACKGROUND).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("API_KEYS", () => {
  it("has no duplicates", async () => {
    const { API_KEYS } = await import("../../../src/shared/ipc");
    expect(new Set(API_KEYS).size).toBe(API_KEYS.length);
  });
});
