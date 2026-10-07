/** Drag handle between sidebar and editor. Live preview while dragging, one commit on release. */
export type DividerDeps = {
  getWidth: () => number;
  onPreview: (width: number) => void;
  onCommit: (width: number) => void;
  min: number;
  max: number;
};

export function installDivider(
  handle: HTMLElement,
  win: Pick<Window, "addEventListener" | "removeEventListener">,
  deps: DividerDeps,
): () => void {
  let startX = 0;
  let startWidth = 0;
  let current = 0;
  let dragging = false;

  const clamp = (w: number) => Math.min(deps.max, Math.max(deps.min, Math.round(w)));
  const move = (e: MouseEvent) => {
    if (!dragging) return;
    current = clamp(startWidth + (e.clientX - startX));
    deps.onPreview(current);
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("is-dragging");
    win.removeEventListener("mousemove", move);
    win.removeEventListener("mouseup", up);
    if (current !== startWidth) deps.onCommit(current);
  };
  const down = (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startWidth = current = deps.getWidth();
    handle.classList.add("is-dragging");
    win.addEventListener("mousemove", move);
    win.addEventListener("mouseup", up);
  };
  handle.addEventListener("mousedown", down);
  return () => {
    handle.removeEventListener("mousedown", down);
    up();
  };
}
