import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_SIZE,
  defaultState,
  FONT_SIZE_STEPS,
  nearestFontStep,
  parseFiles,
  parsePatch,
  parseState,
  parseTheme,
  parseWindowBounds,
  STATE_VERSION,
} from "../../../src/shared/state";

describe("defaultState", () => {
  it("matches the brief: 950×500, 200 px sidebar, 14 px, auto theme, no files", () => {
    const d = defaultState();
    expect(d.version).toBe(STATE_VERSION);
    expect(d.window).toEqual({ width: 950, height: 500 });
    expect(d.sidebarWidth).toBe(200);
    expect(d.sidebarVisible).toBe(true);
    expect(d.fontSize).toBe(14);
    expect(d.theme.mode).toBe("auto");
    expect(d.activePath).toBeNull();
    expect(d.files).toEqual([]);
  });
});

describe("parseState", () => {
  it("returns defaults for non-objects", () => {
    for (const raw of [null, undefined, 42, "x", [], true]) expect(parseState(raw)).toEqual(defaultState());
  });

  it("round-trips a valid state and drops unknown keys", () => {
    const d = defaultState();
    const full = {
      ...d,
      window: { x: 10, y: 20, width: 800, height: 600 },
      sidebarWidth: 240,
      sidebarVisible: false,
      fontSize: 16,
      theme: { mode: "fixed", light: "a", dark: "b", fixed: "c" },
      files: [{ path: "/a.md", anchor: 3, head: 7, scrollTop: 100 }],
      activePath: "/a.md",
      junk: 1,
    };
    const parsed = parseState(full);
    expect(parsed).not.toHaveProperty("junk");
    expect(parsed).toEqual({ ...full, junk: undefined, version: STATE_VERSION });
  });

  it("falls back field by field", () => {
    const parsed = parseState({
      version: 99,
      window: "nope",
      sidebarWidth: "wide",
      sidebarVisible: "yes",
      fontSize: null,
      theme: 7,
      files: "none",
      activePath: "/missing.md",
    });
    expect(parsed).toEqual(defaultState());
  });

  it("clamps numeric ranges", () => {
    const parsed = parseState({ sidebarWidth: 5, fontSize: 500 });
    expect(parsed.sidebarWidth).toBe(120);
    expect(parsed.fontSize).toBe(48);
    expect(parseState({ sidebarWidth: 9999, fontSize: 1 })).toMatchObject({ sidebarWidth: 600, fontSize: 8 });
  });

  it("nulls activePath when it is not in files", () => {
    expect(parseState({ files: [{ path: "/a.md" }], activePath: "/b.md" }).activePath).toBeNull();
    expect(parseState({ files: [{ path: "/a.md" }], activePath: "/a.md" }).activePath).toBe("/a.md");
  });
});

describe("parseWindowBounds", () => {
  const fb = { width: 950, height: 500 };
  it("enforces the minimum size and rounds", () => {
    expect(parseWindowBounds({ width: 10.4, height: 10 }, fb)).toEqual({ width: 400, height: 300 });
    expect(parseWindowBounds({ width: 800.6, height: 600.2 }, fb)).toEqual({ width: 801, height: 600 });
  });
  it("keeps position only when both x and y are numbers", () => {
    expect(parseWindowBounds({ x: 1, width: 800, height: 600 }, fb)).toEqual({ width: 800, height: 600 });
    expect(parseWindowBounds({ x: 1.2, y: -3.7, width: 800, height: 600 }, fb)).toEqual({
      x: 1,
      y: -4,
      width: 800,
      height: 600,
    });
  });
  it("uses the fallback for missing fields and non-objects", () => {
    expect(parseWindowBounds({}, fb)).toEqual(fb);
    expect(parseWindowBounds(null, fb)).toEqual(fb);
    expect(parseWindowBounds({ width: NaN, height: Infinity }, fb)).toEqual(fb);
  });
});

describe("font-size steps", () => {
  it("has five steps two px apart with the default in the middle", () => {
    expect(FONT_SIZE_STEPS).toEqual([10, 12, 14, 16, 18]);
    expect(FONT_SIZE_STEPS[2]).toBe(DEFAULT_FONT_SIZE);
    expect(defaultState().fontSize).toBe(DEFAULT_FONT_SIZE);
  });

  it("snaps any size to the nearest step, ties rounding up, extremes clamped", () => {
    expect(nearestFontStep(14)).toBe(2);
    expect(nearestFontStep(15)).toBe(3);
    expect(nearestFontStep(13)).toBe(2);
    expect(nearestFontStep(10.9)).toBe(0);
    expect(nearestFontStep(8)).toBe(0);
    expect(nearestFontStep(48)).toBe(4);
  });
});

describe("parseTheme", () => {
  const fb = { mode: "auto" as const, light: "l", dark: "d", fixed: "f" };
  it("accepts only known modes and non-empty ids", () => {
    expect(parseTheme({ mode: "fixed", light: "", dark: 3, fixed: "x" }, fb)).toEqual({
      mode: "fixed",
      light: "l",
      dark: "d",
      fixed: "x",
    });
    expect(parseTheme({ mode: "weird" }, fb)).toEqual(fb);
    expect(parseTheme({ mode: "auto" }, { ...fb, mode: "fixed" }).mode).toBe("auto");
    expect(parseTheme("x", fb)).toEqual(fb);
  });
});

describe("parseFiles", () => {
  it("drops invalid entries, de-duplicates, defaults head to anchor", () => {
    const files = parseFiles([
      { path: "/a.md", anchor: 5 },
      { path: "/a.md", anchor: 9 },
      { path: "", anchor: 1 },
      "junk",
      { path: "/b.md", anchor: -4, head: 2.6, scrollTop: "x" },
    ]);
    expect(files).toEqual([
      { path: "/a.md", anchor: 5, head: 5, scrollTop: 0 },
      { path: "/b.md", anchor: 0, head: 3, scrollTop: 0 },
    ]);
  });
  it("returns [] for non-arrays", () => {
    expect(parseFiles({})).toEqual([]);
  });
});

describe("parsePatch", () => {
  const current = { ...defaultState(), files: [{ path: "/a.md", anchor: 0, head: 0, scrollTop: 0 }] };

  it("ignores unknown and invalid keys", () => {
    expect(
      parsePatch({ version: 2, window: { width: 1 }, sidebarWidth: "x", fontSize: null, nope: 1 }, current),
    ).toEqual({});
    expect(parsePatch(null, current)).toEqual({});
  });

  it("validates each present key", () => {
    expect(
      parsePatch({ sidebarWidth: 1, sidebarVisible: false, fontSize: 20, theme: { mode: "fixed" } }, current),
    ).toEqual({
      sidebarWidth: 120,
      sidebarVisible: false,
      fontSize: 20,
      theme: { ...current.theme, mode: "fixed" },
    });
  });

  it("checks activePath against the patched files first, then the current ones", () => {
    expect(parsePatch({ activePath: "/a.md" }, current)).toEqual({ activePath: "/a.md" });
    expect(parsePatch({ activePath: "/zzz.md" }, current)).toEqual({ activePath: null });
    expect(parsePatch({ activePath: null }, current)).toEqual({ activePath: null });
    expect(parsePatch({ files: [{ path: "/n.md" }], activePath: "/n.md" }, current)).toEqual({
      files: [{ path: "/n.md", anchor: 0, head: 0, scrollTop: 0 }],
      activePath: "/n.md",
    });
    expect(parsePatch({ files: [{ path: "/n.md" }], activePath: "/a.md" }, current).activePath).toBeNull();
  });
});
