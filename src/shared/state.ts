import { DEFAULT_SIDEBAR_WIDTH, DEFAULT_WINDOW, MIN_WINDOW } from "./constants";

/** Shape of userData/state.json. Versioned; parsed field by field so a bad file never blocks launch. */
export const STATE_VERSION = 1;

export type WindowBounds = { x?: number; y?: number; width: number; height: number };
export type FileState = { path: string; anchor: number; head: number; scrollTop: number };
export type ThemeMode = "auto" | "fixed";
export type ThemeState = { mode: ThemeMode; light: string; dark: string; fixed: string };

export type AppState = {
  version: typeof STATE_VERSION;
  window: WindowBounds;
  sidebarWidth: number;
  sidebarVisible: boolean;
  fontSize: number;
  /** Syntax highlighting on (default). Off → every token renders in the body text colour. */
  highlight: boolean;
  theme: ThemeState;
  activePath: string | null;
  files: FileState[];
  /**
   * Paths removed from the sidebar, most-recently-closed first, unique, capped at
   * MAX_RECENTLY_CLOSED. Re-opening a path removes it from here (File → Recently Closed). Owned by
   * main; never patched by the renderer.
   */
  recentlyClosed: string[];
};

/** Keys the renderer may patch. `version` and `window` are owned by main. */
export type StatePatch = Partial<
  Pick<
    AppState,
    "sidebarWidth" | "sidebarVisible" | "fontSize" | "highlight" | "theme" | "activePath" | "files"
  >
>;

export const SIDEBAR_WIDTH_RANGE = { min: 120, max: 600 } as const;
export const FONT_SIZE_RANGE = { min: 8, max: 48 } as const;
/** How many closed files File → Recently Closed remembers. */
export const MAX_RECENTLY_CLOSED = 50;
/** The Settings slider's range, in 1 px steps; Cmd +/- zoom may go beyond it (the slider then pins to its end). */
export const FONT_SLIDER_RANGE = { min: 10, max: 18 } as const;
export const DEFAULT_FONT_SIZE = 14;

export function defaultState(): AppState {
  return {
    version: STATE_VERSION,
    window: { ...DEFAULT_WINDOW },
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    sidebarVisible: true,
    fontSize: DEFAULT_FONT_SIZE,
    highlight: true,
    theme: { mode: "auto", light: "macos-light", dark: "macos-dark", fixed: "macos-light" },
    activePath: null,
    files: [],
    recentlyClosed: [],
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (!isFiniteNumber(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

export function parseWindowBounds(raw: unknown, fallback: WindowBounds): WindowBounds {
  if (!isRecord(raw)) return { ...fallback };
  const width = isFiniteNumber(raw["width"])
    ? Math.max(MIN_WINDOW.width, Math.round(raw["width"]))
    : fallback.width;
  const height = isFiniteNumber(raw["height"])
    ? Math.max(MIN_WINDOW.height, Math.round(raw["height"]))
    : fallback.height;
  const out: WindowBounds = { width, height };
  if (isFiniteNumber(raw["x"]) && isFiniteNumber(raw["y"])) {
    out.x = Math.round(raw["x"]);
    out.y = Math.round(raw["y"]);
  }
  return out;
}

export function parseTheme(raw: unknown, fallback: ThemeState): ThemeState {
  if (!isRecord(raw)) return { ...fallback };
  const mode: ThemeMode = raw["mode"] === "fixed" ? "fixed" : raw["mode"] === "auto" ? "auto" : fallback.mode;
  return {
    mode,
    light: isNonEmptyString(raw["light"]) ? raw["light"] : fallback.light,
    dark: isNonEmptyString(raw["dark"]) ? raw["dark"] : fallback.dark,
    fixed: isNonEmptyString(raw["fixed"]) ? raw["fixed"] : fallback.fixed,
  };
}

export function parseFileState(raw: unknown): FileState | null {
  if (!isRecord(raw) || !isNonEmptyString(raw["path"])) return null;
  const anchor = clampInt(raw["anchor"], 0, Number.MAX_SAFE_INTEGER, 0);
  const head = clampInt(raw["head"], 0, Number.MAX_SAFE_INTEGER, anchor);
  return {
    path: raw["path"],
    anchor,
    head,
    scrollTop: clampInt(raw["scrollTop"], 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

/** Drops entries that fail to parse and de-duplicates by path (first wins). */
export function parseFiles(raw: unknown): FileState[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: FileState[] = [];
  for (const item of raw) {
    const f = parseFileState(item);
    if (f && !seen.has(f.path)) {
      seen.add(f.path);
      out.push(f);
    }
  }
  return out;
}

export function parseActivePath(raw: unknown, files: FileState[]): string | null {
  return isNonEmptyString(raw) && files.some((f) => f.path === raw) ? raw : null;
}

/** De-duplicates (first wins, i.e. most recent), drops non-strings, caps at MAX_RECENTLY_CLOSED. */
export function parseRecentlyClosed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (isNonEmptyString(item) && !seen.has(item)) {
      seen.add(item);
      out.push(item);
      if (out.length >= MAX_RECENTLY_CLOSED) break;
    }
  }
  return out;
}

/** Full state from untrusted JSON. Unknown keys dropped, bad values replaced by defaults. */
export function parseState(raw: unknown): AppState {
  const d = defaultState();
  if (!isRecord(raw)) return d;
  const files = parseFiles(raw["files"]);
  return {
    version: STATE_VERSION,
    window: parseWindowBounds(raw["window"], d.window),
    sidebarWidth: clampInt(
      raw["sidebarWidth"],
      SIDEBAR_WIDTH_RANGE.min,
      SIDEBAR_WIDTH_RANGE.max,
      d.sidebarWidth,
    ),
    sidebarVisible: typeof raw["sidebarVisible"] === "boolean" ? raw["sidebarVisible"] : d.sidebarVisible,
    fontSize: clampInt(raw["fontSize"], FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, d.fontSize),
    highlight: typeof raw["highlight"] === "boolean" ? raw["highlight"] : d.highlight,
    theme: parseTheme(raw["theme"], d.theme),
    activePath: parseActivePath(raw["activePath"], files),
    files,
    recentlyClosed: parseRecentlyClosed(raw["recentlyClosed"]),
  };
}

/**
 * A patch from the renderer. Only known keys, each validated like the full parser;
 * invalid keys are ignored (returned patch may be empty). `activePath` is validated
 * against the patched-or-current file list.
 */
export function parsePatch(raw: unknown, current: AppState): StatePatch {
  const out: StatePatch = {};
  if (!isRecord(raw)) return out;
  if ("sidebarWidth" in raw && isFiniteNumber(raw["sidebarWidth"]))
    out.sidebarWidth = clampInt(
      raw["sidebarWidth"],
      SIDEBAR_WIDTH_RANGE.min,
      SIDEBAR_WIDTH_RANGE.max,
      current.sidebarWidth,
    );
  if (typeof raw["sidebarVisible"] === "boolean") out.sidebarVisible = raw["sidebarVisible"];
  if ("fontSize" in raw && isFiniteNumber(raw["fontSize"]))
    out.fontSize = clampInt(raw["fontSize"], FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, current.fontSize);
  if (typeof raw["highlight"] === "boolean") out.highlight = raw["highlight"];
  if (isRecord(raw["theme"])) out.theme = parseTheme(raw["theme"], current.theme);
  if (Array.isArray(raw["files"])) out.files = parseFiles(raw["files"]);
  if ("activePath" in raw) {
    const files = out.files ?? current.files;
    out.activePath = raw["activePath"] === null ? null : parseActivePath(raw["activePath"], files);
  }
  return out;
}
