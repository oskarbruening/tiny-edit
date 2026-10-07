/** Window-wide handling of Finder drops. The text is never touched: a drop always means "open these". */
export type DropDeps = {
  pathForFile: (file: File) => string;
  onPaths: (paths: string[]) => void;
  onDragState: (over: boolean) => void;
};

const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");

export function installDropzone(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  deps: DropDeps,
): () => void {
  let depth = 0;
  const enter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    if (depth === 1) deps.onDragState(true);
  };
  const over = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const leave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) deps.onDragState(false);
  };
  const drop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    deps.onDragState(false);
    const paths = Array.from(e.dataTransfer?.files ?? [])
      .map((f) => deps.pathForFile(f))
      .filter((p) => p.length > 0);
    if (paths.length) deps.onPaths(paths);
  };
  target.addEventListener("dragenter", enter);
  target.addEventListener("dragover", over);
  target.addEventListener("dragleave", leave);
  target.addEventListener("drop", drop);
  return () => {
    target.removeEventListener("dragenter", enter);
    target.removeEventListener("dragover", over);
    target.removeEventListener("dragleave", leave);
    target.removeEventListener("drop", drop);
  };
}
