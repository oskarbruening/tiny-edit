import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultState } from "../../../src/shared/state";
import {
  BUILTIN_THEMES,
  CATPPUCCIN_MOCHA,
  DEFAULT_DARK_ID,
  DEFAULT_LIGHT_ID,
  luminance,
  MEADOW,
  parseThemeTokens,
  parseUserTheme,
  resolveTheme,
  SYSTEM_MONO,
  themeCssVars,
  TOKYO_NIGHT,
} from "../../../src/shared/themes";

const HEX = /^#[0-9a-f]{6}$/;

describe("built-in themes", () => {
  it("has eight distinct, valid themes with the agreed defaults", () => {
    expect(BUILTIN_THEMES.map((t) => t.id)).toEqual([
      "meadow",
      "tokyo-night",
      "catppuccin-latte",
      "catppuccin-frappe",
      "catppuccin-macchiato",
      "catppuccin-mocha",
      "macos-light",
      "macos-dark",
    ]);
    expect(BUILTIN_THEMES.map((t) => t.appearance)).toEqual([
      "light",
      "dark",
      "light",
      "dark",
      "dark",
      "dark",
      "light",
      "dark",
    ]);
    for (const t of BUILTIN_THEMES) {
      expect(t.builtin).toBe(true);
      for (const v of Object.values(t.tokens.colors)) expect(v, t.id).toMatch(HEX);
      for (const v of Object.values(t.tokens.syntax)) expect(v, t.id).toMatch(HEX);
      expect(t.tokens.radius).toBeGreaterThanOrEqual(0);
    }
    expect(DEFAULT_LIGHT_ID).toBe(MEADOW.id);
    expect(DEFAULT_DARK_ID).toBe(CATPPUCCIN_MOCHA.id);
    expect(defaultState().theme).toEqual({
      mode: "auto",
      light: DEFAULT_LIGHT_ID,
      dark: DEFAULT_DARK_ID,
      fixed: DEFAULT_LIGHT_ID,
    });
  });

  it("dark themes really are dark and light ones light", () => {
    for (const t of BUILTIN_THEMES)
      expect(luminance(t.tokens.colors.surface) < 0.4, t.id).toBe(t.appearance === "dark");
  });
});

describe("themeCssVars", () => {
  it("produces every --te-* variable that the renderer's CSS consumes (except layout vars)", () => {
    const css = ["styles.css", "settings/settings.css"]
      .map((f) => readFileSync(new URL(`../../../src/renderer/${f}`, import.meta.url), "utf8"))
      .join("\n");
    const used = new Set([...css.matchAll(/var\((--te-[a-z0-9-]+)/g)].map((m) => m[1]!));
    const layout = new Set(["--te-sidebar-width", "--te-titlebar-height", "--te-font-size"]);
    const produced = new Set(Object.keys(themeCssVars(MEADOW.tokens)));
    for (const name of used) if (!layout.has(name)) expect(produced.has(name), name).toBe(true);
  });

  it("kebab-cases roles, derives radii, and falls back to the system mono stack", () => {
    const vars = themeCssVars(MEADOW.tokens);
    expect(vars["--te-surface-container-high"]).toBe("#ebe8e4");
    expect(vars["--te-syntax-inline-code"]).toBe("#8a4b12");
    expect(vars["--te-syntax-bracket-1"]).toBe("#b45309");
    expect(vars["--te-radius-sm"]).toBe("3px");
    expect(vars["--te-radius-md"]).toBe("6px");
    expect(vars["--te-font-mono"]).toBe(SYSTEM_MONO);
    expect(themeCssVars(TOKYO_NIGHT.tokens)["--te-font-mono"]).toContain("JetBrains Mono");
    expect(themeCssVars({ ...MEADOW.tokens, radius: 0 })["--te-radius-sm"]).toBe("2px");
  });

  it("every built-in matches the Meadow defaults hard-coded in styles.css", () => {
    const css = readFileSync(new URL("../../../src/renderer/styles.css", import.meta.url), "utf8");
    for (const [name, value] of Object.entries(themeCssVars(MEADOW.tokens))) {
      const m = css.match(new RegExp(`${name}: ([^;]+);`));
      if (m) expect(m[1]!.trim(), name).toBe(value);
    }
  });
});

describe("parseThemeTokens", () => {
  it("returns a copy of the fallback for garbage", () => {
    const parsed = parseThemeTokens("nope");
    expect(parsed).toEqual(MEADOW.tokens);
    expect(parsed).not.toBe(MEADOW.tokens);
  });
  it("accepts valid fields, lower-cases hex, clamps radius, trims fonts", () => {
    const parsed = parseThemeTokens({
      colors: { surface: "#ABCDEF", ink: "red", bogus: "#000000" },
      syntax: { keyword: "#123456", string: 12 },
      radius: 99.6,
      fontFamily: "  Menlo  ",
    });
    expect(parsed.colors.surface).toBe("#abcdef");
    expect(parsed.colors.ink).toBe(MEADOW.tokens.colors.ink);
    expect(parsed.colors).not.toHaveProperty("bogus");
    expect(parsed.syntax.keyword).toBe("#123456");
    expect(parsed.syntax.string).toBe(MEADOW.tokens.syntax.string);
    expect(parsed.radius).toBe(24);
    expect(parsed.fontFamily).toBe("Menlo");
    expect(parseThemeTokens({ radius: -5, fontFamily: null }).radius).toBe(0);
    expect(parseThemeTokens({ fontFamily: null }).fontFamily).toBeNull();
    expect(parseThemeTokens({ fontFamily: "   " }).fontFamily).toBe(MEADOW.tokens.fontFamily);
    expect(parseThemeTokens({ radius: Number.NaN }).radius).toBe(MEADOW.tokens.radius);
  });
});

describe("parseUserTheme", () => {
  it("uses the file name as id, infers appearance from the surface, and fills from the matching built-in", () => {
    const dark = parseUserTheme({ colors: { surface: "#101010" } }, "my-dark");
    expect(dark).toMatchObject({ id: "my-dark", name: "my-dark", builtin: false, appearance: "dark" });
    expect(dark!.tokens.colors.surface).toBe("#101010");
    expect(dark!.tokens.colors.ink).toBe(CATPPUCCIN_MOCHA.tokens.colors.ink);
    const light = parseUserTheme({ colors: { surface: "#fafafa" } }, "my-light");
    expect(light).toMatchObject({ appearance: "light" });
    expect(light!.tokens.colors.ink).toBe(MEADOW.tokens.colors.ink);
  });
  it("accepts explicit id/name/appearance and rejects unusable or built-in ids", () => {
    const t = parseUserTheme(
      { id: "Solar", name: "  Solarized  ", appearance: "dark", colors: { surface: "#fdf6e3" } },
      "x",
    );
    expect(t).toMatchObject({ id: "solar", name: "Solarized", appearance: "dark" });
    expect(t!.tokens.colors.surface).toBe("#fdf6e3");
    expect(t!.tokens.syntax.keyword).toBe(CATPPUCCIN_MOCHA.tokens.syntax.keyword);
    expect(parseUserTheme({}, "Bad Name!")).toBeNull();
    expect(parseUserTheme({ id: "meadow" }, "x")).toBeNull();
    expect(parseUserTheme(null, "fallback")).toMatchObject({
      id: "fallback",
      name: "fallback",
      appearance: "light",
    });
    expect(parseUserTheme({ name: "x".repeat(100) }, "long")!.name).toHaveLength(60);
  });
});

describe("resolveTheme", () => {
  const setting = { mode: "auto" as const, light: "meadow", dark: "tokyo-night", fixed: "catppuccin-latte" };
  it("picks the pair member in auto mode and the fixed id otherwise", () => {
    expect(resolveTheme(setting, BUILTIN_THEMES, "light").id).toBe("meadow");
    expect(resolveTheme(setting, BUILTIN_THEMES, "dark").id).toBe("tokyo-night");
    expect(resolveTheme({ ...setting, mode: "fixed" }, BUILTIN_THEMES, "dark").id).toBe("catppuccin-latte");
  });
  it("finds user themes and falls back to the defaults when an id is gone", () => {
    const user = { ...MEADOW, id: "mine", builtin: false };
    expect(
      resolveTheme({ ...setting, mode: "fixed", fixed: "mine" }, [...BUILTIN_THEMES, user], "light"),
    ).toBe(user);
    expect(resolveTheme({ ...setting, mode: "fixed", fixed: "gone" }, BUILTIN_THEMES, "dark").id).toBe(
      DEFAULT_LIGHT_ID,
    );
    expect(resolveTheme({ ...setting, dark: "gone" }, BUILTIN_THEMES, "dark").id).toBe(DEFAULT_DARK_ID);
    expect(resolveTheme({ ...setting, light: "gone" }, [], "light").id).toBe(DEFAULT_LIGHT_ID);
  });
});
