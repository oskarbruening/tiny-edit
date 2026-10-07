import type { Rectangle } from "electron";
import { MIN_WINDOW } from "../shared/constants";
import type { WindowBounds } from "../shared/state";

export type DisplayLike = { workArea: Rectangle };

/** How much of the window must remain inside some display's work area to keep the saved position. */
const VISIBLE_MARGIN = 100;

/**
 * Saved bounds → bounds safe to open with. Size is clamped to the minimum; the
 * position is kept only if at least a VISIBLE_MARGIN square of the window overlaps
 * a connected display's work area (handles unplugged monitors). Otherwise x/y are
 * dropped and Electron centres the window.
 */
export function validateBounds(saved: WindowBounds, displays: readonly DisplayLike[]): WindowBounds {
  const width = Math.max(MIN_WINDOW.width, Math.round(saved.width));
  const height = Math.max(MIN_WINDOW.height, Math.round(saved.height));
  if (saved.x === undefined || saved.y === undefined) return { width, height };
  const { x, y } = saved;
  const fits = displays.some(({ workArea: a }) => {
    const overlapX = Math.min(x + width, a.x + a.width) - Math.max(x, a.x);
    const overlapY = Math.min(y + height, a.y + a.height) - Math.max(y, a.y);
    return overlapX >= Math.min(VISIBLE_MARGIN, width) && overlapY >= Math.min(VISIBLE_MARGIN, height);
  });
  return fits ? { x, y, width, height } : { width, height };
}

export type TrackableWindow = {
  on(event: "resize" | "move" | "close", listener: () => void): unknown;
  getNormalBounds(): Rectangle;
  isFullScreen(): boolean;
  isMinimized(): boolean;
};

export type TrackOptions = { onChange: (bounds: WindowBounds) => void; debounceMs?: number };

/**
 * Reports the window's normal (un-maximised) bounds after resize/move settles, and
 * once more on close. Fullscreen and minimised states are never recorded.
 */
export function trackWindowState(win: TrackableWindow, opts: TrackOptions): () => void {
  const debounceMs = opts.debounceMs ?? 250;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const report = (): void => {
    if (win.isFullScreen() || win.isMinimized()) return;
    const b = win.getNormalBounds();
    opts.onChange({ x: b.x, y: b.y, width: b.width, height: b.height });
  };
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      report();
    }, debounceMs);
  };
  const onClose = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    report();
  };

  win.on("resize", schedule);
  win.on("move", schedule);
  win.on("close", onClose);

  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
