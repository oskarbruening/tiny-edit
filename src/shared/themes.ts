/**
 * Theme model (hub token roles + editor syntax roles). Built-ins live here; user themes are
 * `userData/themes/*.json` parsed through the same defensive parser. Isomorphic: no Node/DOM.
 */
import type { ThemeState } from "./state";

export type Appearance = "light" | "dark";

export type ThemeColors = {
  primary: string;
  card: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondaryContainer: string;
  surface: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  line: string;
  ink: string;
  muted: string;
  sel: string;
  danger: string;
  dangerContainer: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
};

export type ThemeSyntax = {
  heading: string;
  strong: string;
  emphasis: string;
  link: string;
  url: string;
  inlineCode: string;
  quote: string;
  listMarker: string;
  hr: string;
  marker: string;
  codeFence: string;
  htmlTag: string;
  bracketMatch: string;
  keyword: string;
  string: string;
  number: string;
  comment: string;
  operator: string;
  type: string;
  function: string;
  property: string;
  variable: string;
  atom: string;
  meta: string;
  invalid: string;
  bracket1: string;
  bracket2: string;
  bracket3: string;
};

export type ThemeTokens = {
  colors: ThemeColors;
  syntax: ThemeSyntax;
  /** Base radius in px (0–24); the scale derives from it. */
  radius: number;
  /** Monospace stack, or null for the system default. Installed fonts only; nothing is downloaded. */
  fontFamily: string | null;
};

export type Theme = {
  /** Slug: built-in name or the user file's basename. */
  id: string;
  name: string;
  builtin: boolean;
  appearance: Appearance;
  tokens: ThemeTokens;
};

export const DEFAULT_LIGHT_ID = "macos-light";
export const DEFAULT_DARK_ID = "macos-dark";
export const SYSTEM_MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
export const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const HEX = /^#[0-9a-fA-F]{6}$/;

const theme = (
  id: string,
  name: string,
  appearance: Appearance,
  colors: ThemeColors,
  syntax: ThemeSyntax,
  radius: number,
  fontFamily: string | null = null,
): Theme => ({ id, name, builtin: true, appearance, tokens: { colors, syntax, radius, fontFamily } });

export const MEADOW: Theme = theme(
  "meadow",
  "Meadow",
  "light",
  {
    primary: "#2f6f4f",
    card: "#ffffff",
    onPrimary: "#ffffff",
    primaryContainer: "#d3e8db",
    onPrimaryContainer: "#0d2b1d",
    secondaryContainer: "#dfe9e1",
    surface: "#fbf9f7",
    surfaceContainer: "#f1efeb",
    surfaceContainerHigh: "#ebe8e4",
    line: "#dfdcd6",
    ink: "#1c1b1a",
    muted: "#5f5e59",
    sel: "#dcebe1",
    danger: "#b3261e",
    dangerContainer: "#f9dedc",
    inverseSurface: "#313030",
    inverseOnSurface: "#f4f0ee",
    inversePrimary: "#9fd6b6",
  },
  {
    heading: "#2f6f4f",
    strong: "#1c1b1a",
    emphasis: "#1c1b1a",
    link: "#1d5f8a",
    url: "#5f5e59",
    inlineCode: "#8a4b12",
    quote: "#5f5e59",
    listMarker: "#2f6f4f",
    hr: "#9b988f",
    marker: "#9b988f",
    codeFence: "#9b988f",
    htmlTag: "#1d5f8a",
    bracketMatch: "#d3e8db",
    keyword: "#7c3aed",
    string: "#2f6f4f",
    number: "#b45309",
    comment: "#8a877e",
    operator: "#5f5e59",
    type: "#0e7490",
    function: "#1d5f8a",
    property: "#7c2d12",
    variable: "#1c1b1a",
    atom: "#b45309",
    meta: "#8a877e",
    invalid: "#b3261e",
    bracket1: "#b45309",
    bracket2: "#7c3aed",
    bracket3: "#0e7490",
  },
  6,
);

export const TOKYO_NIGHT: Theme = theme(
  "tokyo-night",
  "Tokyo Night",
  "dark",
  {
    primary: "#7aa2f7",
    card: "#1f2335",
    onPrimary: "#16161e",
    primaryContainer: "#283457",
    onPrimaryContainer: "#c0caf5",
    secondaryContainer: "#2a2f41",
    surface: "#1a1b26",
    surfaceContainer: "#16161e",
    surfaceContainerHigh: "#24283b",
    line: "#2f3549",
    ink: "#c0caf5",
    muted: "#8189b0",
    sel: "#2d3f76",
    danger: "#f7768e",
    dangerContainer: "#3f2335",
    inverseSurface: "#c0caf5",
    inverseOnSurface: "#1a1b26",
    inversePrimary: "#3d59a1",
  },
  {
    heading: "#7aa2f7",
    strong: "#c0caf5",
    emphasis: "#c0caf5",
    link: "#7aa2f7",
    url: "#565f89",
    inlineCode: "#9ece6a",
    quote: "#565f89",
    listMarker: "#ff9e64",
    hr: "#3b4261",
    marker: "#565f89",
    codeFence: "#565f89",
    htmlTag: "#f7768e",
    bracketMatch: "#3d59a1",
    keyword: "#bb9af7",
    string: "#9ece6a",
    number: "#ff9e64",
    comment: "#565f89",
    operator: "#89ddff",
    type: "#2ac3de",
    function: "#7aa2f7",
    property: "#73daca",
    variable: "#c0caf5",
    atom: "#ff9e64",
    meta: "#e0af68",
    invalid: "#f7768e",
    bracket1: "#e0af68",
    bracket2: "#bb9af7",
    bracket3: "#7dcfff",
  },
  4,
  `"JetBrains Mono", ${SYSTEM_MONO}`,
);

type Flavor = {
  base: string;
  mantle: string;
  crust: string;
  text: string;
  subtext0: string;
  overlay0: string;
  surface0: string;
  surface1: string;
  mauve: string;
  red: string;
  peach: string;
  yellow: string;
  green: string;
  teal: string;
  sky: string;
  sapphire: string;
  blue: string;
  lavender: string;
  pink: string;
};

/** Catppuccin's own syntax conventions, per flavour. */
const catppuccinSyntax = (f: Flavor): ThemeSyntax => ({
  heading: f.blue,
  strong: f.text,
  emphasis: f.text,
  link: f.blue,
  url: f.subtext0,
  inlineCode: f.green,
  quote: f.subtext0,
  listMarker: f.peach,
  hr: f.surface1,
  marker: f.overlay0,
  codeFence: f.overlay0,
  htmlTag: f.pink,
  bracketMatch: f.surface1,
  keyword: f.mauve,
  string: f.green,
  number: f.peach,
  comment: f.overlay0,
  operator: f.sky,
  type: f.yellow,
  function: f.blue,
  property: f.teal,
  variable: f.text,
  atom: f.peach,
  meta: f.pink,
  invalid: f.red,
  bracket1: f.peach,
  bracket2: f.mauve,
  bracket3: f.sapphire,
});

const LATTE: Flavor = {
  base: "#eff1f5",
  mantle: "#e6e9ef",
  crust: "#dce0e8",
  text: "#4c4f69",
  subtext0: "#6c6f85",
  overlay0: "#9ca0b0",
  surface0: "#ccd0da",
  surface1: "#bcc0cc",
  mauve: "#8839ef",
  red: "#d20f39",
  peach: "#fe640b",
  yellow: "#df8e1d",
  green: "#40a02b",
  teal: "#179299",
  sky: "#04a5e5",
  sapphire: "#209fb5",
  blue: "#1e66f5",
  lavender: "#7287fd",
  pink: "#ea76cb",
};
const FRAPPE: Flavor = {
  base: "#303446",
  mantle: "#292c3c",
  crust: "#232634",
  text: "#c6d0f5",
  subtext0: "#a5adce",
  overlay0: "#737994",
  surface0: "#414559",
  surface1: "#51576d",
  mauve: "#ca9ee6",
  red: "#e78284",
  peach: "#ef9f76",
  yellow: "#e5c890",
  green: "#a6d189",
  teal: "#81c8be",
  sky: "#99d1db",
  sapphire: "#85c1dc",
  blue: "#8caaee",
  lavender: "#babbf1",
  pink: "#f4b8e4",
};
const MACCHIATO: Flavor = {
  base: "#24273a",
  mantle: "#1e2030",
  crust: "#181926",
  text: "#cad3f5",
  subtext0: "#a5adcb",
  overlay0: "#6e738d",
  surface0: "#363a4f",
  surface1: "#494d64",
  mauve: "#c6a0f6",
  red: "#ed8796",
  peach: "#f5a97f",
  yellow: "#eed49f",
  green: "#a6da95",
  teal: "#8bd5ca",
  sky: "#91d7e3",
  sapphire: "#7dc4e4",
  blue: "#8aadf4",
  lavender: "#b7bdf8",
  pink: "#f5bde6",
};
const MOCHA: Flavor = {
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",
  text: "#cdd6f4",
  subtext0: "#a6adc8",
  overlay0: "#6c7086",
  surface0: "#313244",
  surface1: "#45475a",
  mauve: "#cba6f7",
  red: "#f38ba8",
  peach: "#fab387",
  yellow: "#f9e2af",
  green: "#a6e3a1",
  teal: "#94e2d5",
  sky: "#89dceb",
  sapphire: "#74c7ec",
  blue: "#89b4fa",
  lavender: "#b4befe",
  pink: "#f5c2e7",
};

export const CATPPUCCIN_LATTE: Theme = theme(
  "catppuccin-latte",
  "Catppuccin Latte",
  "light",
  {
    primary: "#8839ef",
    card: "#ffffff",
    onPrimary: "#eff1f5",
    primaryContainer: "#daccf4",
    onPrimaryContainer: "#3d1a6c",
    secondaryContainer: "#e3dbf4",
    surface: "#eff1f5",
    surfaceContainer: "#e6e9ef",
    surfaceContainerHigh: "#dce0e8",
    line: "#ccd0da",
    ink: "#4c4f69",
    muted: "#6c6f85",
    sel: "#dfd4f4",
    danger: "#d20f39",
    dangerContainer: "#eac8d3",
    inverseSurface: "#4c4f69",
    inverseOnSurface: "#eff1f5",
    inversePrimary: "#c4a4f2",
  },
  catppuccinSyntax(LATTE),
  6,
);
export const CATPPUCCIN_FRAPPE: Theme = theme(
  "catppuccin-frappe",
  "Catppuccin Frappé",
  "dark",
  {
    primary: "#ca9ee6",
    card: "#393d50",
    onPrimary: "#232634",
    primaryContainer: "#554d6c",
    onPrimaryContainer: "#c6d0f5",
    secondaryContainer: "#46435c",
    surface: "#303446",
    surfaceContainer: "#292c3c",
    surfaceContainerHigh: "#414559",
    line: "#51576d",
    ink: "#c6d0f5",
    muted: "#a5adce",
    sel: "#5e5476",
    danger: "#e78284",
    dangerContainer: "#584554",
    inverseSurface: "#c6d0f5",
    inverseOnSurface: "#303446",
    inversePrimary: "#6e5c84",
  },
  catppuccinSyntax(FRAPPE),
  6,
);
export const CATPPUCCIN_MACCHIATO: Theme = theme(
  "catppuccin-macchiato",
  "Catppuccin Macchiato",
  "dark",
  {
    primary: "#c6a0f6",
    card: "#2e3146",
    onPrimary: "#181926",
    primaryContainer: "#4b4467",
    onPrimaryContainer: "#cad3f5",
    secondaryContainer: "#3b3854",
    surface: "#24273a",
    surfaceContainer: "#1e2030",
    surfaceContainerHigh: "#363a4f",
    line: "#494d64",
    ink: "#cad3f5",
    muted: "#a5adcb",
    sel: "#554b72",
    danger: "#ed8796",
    dangerContainer: "#503c4e",
    inverseSurface: "#cad3f5",
    inverseOnSurface: "#24273a",
    inversePrimary: "#665684",
  },
  catppuccinSyntax(MACCHIATO),
  6,
);
export const CATPPUCCIN_MOCHA: Theme = theme(
  "catppuccin-mocha",
  "Catppuccin Mocha",
  "dark",
  {
    primary: "#cba6f7",
    card: "#28293a",
    onPrimary: "#11111b",
    primaryContainer: "#483f5e",
    onPrimaryContainer: "#cdd6f4",
    secondaryContainer: "#36314a",
    surface: "#1e1e2e",
    surfaceContainer: "#181825",
    surfaceContainerHigh: "#313244",
    line: "#45475a",
    ink: "#cdd6f4",
    muted: "#a6adc8",
    sel: "#52476a",
    danger: "#f38ba8",
    dangerContainer: "#4d3649",
    inverseSurface: "#cdd6f4",
    inverseOnSurface: "#1e1e2e",
    inversePrimary: "#65547e",
  },
  catppuccinSyntax(MOCHA),
  6,
);

/** macOS Light: Apple's system light appearance. textBackground (white) surface, systemBlue accent,
 * SF Mono via the system default; syntax follows Xcode's Default (Light) accents. */
export const MACOS_LIGHT: Theme = theme(
  "macos-light",
  "macOS Light",
  "light",
  {
    primary: "#007aff",
    card: "#ffffff",
    onPrimary: "#ffffff",
    primaryContainer: "#d6e9ff",
    onPrimaryContainer: "#003a75",
    secondaryContainer: "#e5e5ea",
    surface: "#ffffff",
    surfaceContainer: "#f2f2f7",
    surfaceContainerHigh: "#e5e5ea",
    line: "#d1d1d6",
    ink: "#1d1d1f",
    muted: "#6e6e73",
    sel: "#b3d7ff",
    danger: "#ff3b30",
    dangerContainer: "#ffe5e3",
    inverseSurface: "#1d1d1f",
    inverseOnSurface: "#ffffff",
    inversePrimary: "#0a84ff",
  },
  {
    heading: "#007aff",
    strong: "#1d1d1f",
    emphasis: "#1d1d1f",
    link: "#007aff",
    url: "#6e6e73",
    inlineCode: "#d12f1b",
    quote: "#6e6e73",
    listMarker: "#ff9500",
    hr: "#c7c7cc",
    marker: "#aeaeb2",
    codeFence: "#aeaeb2",
    htmlTag: "#ad3da4",
    bracketMatch: "#b3d7ff",
    keyword: "#ad3da4",
    string: "#d12f1b",
    number: "#272ad8",
    comment: "#5d6c79",
    operator: "#ad3da4",
    type: "#0f68a0",
    function: "#3e8087",
    property: "#804fb8",
    variable: "#1d1d1f",
    atom: "#272ad8",
    meta: "#947100",
    invalid: "#ff3b30",
    bracket1: "#ff9500",
    bracket2: "#af52de",
    bracket3: "#0f68a0",
  },
  6,
);

/** macOS Dark: Apple's system dark appearance. textBackground surface, systemBlue accent,
 * SF Mono via the system default; syntax follows Xcode's Default (Dark) accents. */
export const MACOS_DARK: Theme = theme(
  "macos-dark",
  "macOS Dark",
  "dark",
  {
    primary: "#0a84ff",
    card: "#2a2a2c",
    onPrimary: "#ffffff",
    primaryContainer: "#0b3a66",
    onPrimaryContainer: "#d4e4ff",
    secondaryContainer: "#2e2e30",
    surface: "#1e1e1e",
    surfaceContainer: "#262628",
    surfaceContainerHigh: "#303032",
    line: "#3a3a3c",
    ink: "#f5f5f7",
    muted: "#98989d",
    sel: "#3f638b",
    danger: "#ff453a",
    dangerContainer: "#48201c",
    inverseSurface: "#f5f5f7",
    inverseOnSurface: "#1e1e1e",
    inversePrimary: "#409cff",
  },
  {
    heading: "#0a84ff",
    strong: "#f5f5f7",
    emphasis: "#f5f5f7",
    link: "#0a84ff",
    url: "#98989d",
    inlineCode: "#ff8170",
    quote: "#98989d",
    listMarker: "#ff9f0a",
    hr: "#48484a",
    marker: "#6c6c70",
    codeFence: "#6c6c70",
    htmlTag: "#ff7ab2",
    bracketMatch: "#3f638b",
    keyword: "#ff7ab2",
    string: "#ff8170",
    number: "#d9c97c",
    comment: "#7f8c98",
    operator: "#ff7ab2",
    type: "#5dd8ff",
    function: "#67b7a4",
    property: "#64d2ff",
    variable: "#f5f5f7",
    atom: "#d9c97c",
    meta: "#ff9f0a",
    invalid: "#ff453a",
    bracket1: "#ff9f0a",
    bracket2: "#bf5af2",
    bracket3: "#64d2ff",
  },
  6,
);

export const BUILTIN_THEMES: readonly Theme[] = [
  MEADOW,
  TOKYO_NIGHT,
  CATPPUCCIN_LATTE,
  CATPPUCCIN_FRAPPE,
  CATPPUCCIN_MACCHIATO,
  CATPPUCCIN_MOCHA,
  MACOS_LIGHT,
  MACOS_DARK,
];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseColors<T extends Record<string, string>>(raw: unknown, fallback: T): T {
  const out = { ...fallback } as Record<string, string>;
  if (isRecord(raw))
    for (const key of Object.keys(fallback))
      if (typeof raw[key] === "string" && HEX.test(raw[key])) out[key] = raw[key].toLowerCase();
  return out as T;
}

/** Field-by-field fallback to `fallback` (Meadow by default): a hand-edited file can never break the editor. */
export function parseThemeTokens(raw: unknown, fallback: ThemeTokens = MEADOW.tokens): ThemeTokens {
  if (!isRecord(raw)) return structuredClone(fallback);
  const radiusRaw = raw["radius"];
  const radius =
    typeof radiusRaw === "number" && Number.isFinite(radiusRaw)
      ? Math.min(24, Math.max(0, Math.round(radiusRaw)))
      : fallback.radius;
  const fontRaw = raw["fontFamily"];
  const fontFamily =
    fontRaw === null
      ? null
      : typeof fontRaw === "string" && fontRaw.trim()
        ? fontRaw.trim().slice(0, 200)
        : fallback.fontFamily;
  return {
    colors: parseColors(raw["colors"], fallback.colors),
    syntax: parseColors(raw["syntax"], fallback.syntax),
    radius,
    fontFamily,
  };
}

/** Relative luminance of a #rrggbb colour (0 dark … 1 light). */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/**
 * A user theme file. `id` falls back to the file's basename; `appearance` to the surface's
 * luminance; tokens field by field to the matching built-in default. Returns null only when the
 * id is unusable.
 */
export function parseUserTheme(raw: unknown, fallbackId: string): Theme | null {
  const rec = isRecord(raw) ? raw : {};
  const idRaw = typeof rec["id"] === "string" ? rec["id"].trim().toLowerCase() : fallbackId.toLowerCase();
  if (!THEME_ID_PATTERN.test(idRaw) || BUILTIN_THEMES.some((t) => t.id === idRaw)) return null;
  const appearanceRaw = rec["appearance"];
  const probe = parseThemeTokens(rec, MEADOW.tokens);
  const appearance: Appearance =
    appearanceRaw === "dark" || appearanceRaw === "light"
      ? appearanceRaw
      : luminance(probe.colors.surface) < 0.4
        ? "dark"
        : "light";
  const base = appearance === "dark" ? CATPPUCCIN_MOCHA.tokens : MEADOW.tokens;
  const name =
    typeof rec["name"] === "string" && rec["name"].trim() ? rec["name"].trim().slice(0, 60) : idRaw;
  return { id: idRaw, name, builtin: false, appearance, tokens: parseThemeTokens(rec, base) };
}

const kebab = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();

/** Tokens → CSS custom properties for the root element. Every `var(--te-*)` in styles.css is produced here. */
export function themeCssVars(tokens: ThemeTokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tokens.colors)) out[`--te-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(tokens.syntax)) out[`--te-syntax-${kebab(k)}`] = v;
  out["--te-radius-sm"] = `${Math.max(2, Math.round(tokens.radius * 0.5))}px`;
  out["--te-radius-md"] = `${tokens.radius}px`;
  out["--te-font-mono"] = tokens.fontFamily ?? SYSTEM_MONO;
  return out;
}

/** The theme to show for a theme setting, the available themes and the OS appearance. Never fails. */
export function resolveTheme(setting: ThemeState, themes: readonly Theme[], appearance: Appearance): Theme {
  const wanted =
    setting.mode === "auto" ? (appearance === "dark" ? setting.dark : setting.light) : setting.fixed;
  const byId = (id: string) => themes.find((t) => t.id === id) ?? BUILTIN_THEMES.find((t) => t.id === id);
  const fallbackId =
    setting.mode === "auto" ? (appearance === "dark" ? DEFAULT_DARK_ID : DEFAULT_LIGHT_ID) : DEFAULT_LIGHT_ID;
  return byId(wanted) ?? byId(fallbackId) ?? MEADOW;
}
