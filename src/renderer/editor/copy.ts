import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

/** Writes the copied text somewhere (the clipboard, via IPC, in the app; a spy in tests). */
export type CopyFn = (text: string) => void;

/** How long the button shows its "copied" tick before reverting to the copy glyph. */
const COPIED_MS = 1100;

const SVG_NS = "http://www.w3.org/2000/svg";
const copiedTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function el(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function icon(...children: SVGElement[]): SVGSVGElement {
  const svg = el("svg", {
    viewBox: "0 0 24 24",
    width: "13",
    height: "13",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }) as SVGSVGElement;
  svg.append(...children);
  return svg;
}

const copyIcon = (): SVGSVGElement =>
  icon(
    el("rect", { x: "9", y: "9", width: "13", height: "13", rx: "2" }),
    el("path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }),
  );

const checkIcon = (): SVGSVGElement => icon(el("path", { d: "M20 6 9 17l-5-5" }));

/** Copy, then flash a tick for a moment. */
function flashCopied(btn: HTMLElement): void {
  btn.classList.add("is-copied");
  btn.replaceChildren(checkIcon());
  const pending = copiedTimers.get(btn);
  if (pending) clearTimeout(pending);
  copiedTimers.set(
    btn,
    setTimeout(() => {
      btn.classList.remove("is-copied");
      btn.replaceChildren(copyIcon());
      copiedTimers.delete(btn);
    }, COPIED_MS),
  );
}

class CopyWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly kind: "inline" | "block",
    private readonly from: number,
    private readonly copy: CopyFn,
  ) {
    super();
  }

  override eq(other: CopyWidget): boolean {
    return other.text === this.text && other.kind === this.kind && other.from === this.from;
  }

  override toDOM(): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `te-copy te-copy-${this.kind}`;
    btn.contentEditable = "false";
    btn.title = "Copy";
    btn.setAttribute("aria-label", this.kind === "block" ? "Copy code block" : "Copy code");
    if (this.kind === "block") btn.dataset["from"] = String(this.from);
    btn.append(copyIcon());
    // Keep the click from moving the caret into the code or blurring the editor.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      this.copy(this.text);
      flashCopied(btn);
    });
    if (this.kind === "block") return btn;
    // Inline: a zero-size anchor keeps the floating button out of the text flow (no layout shift).
    const anchor = document.createElement("span");
    anchor.className = "te-copy-anchor";
    anchor.append(btn);
    return anchor;
  }
}

/** Content between an `InlineCode` node's backtick marks, or null when the span is empty. */
export function inlineCodeInner(node: SyntaxNode): { from: number; to: number } | null {
  const marks = node.getChildren("CodeMark");
  const from = marks.length ? marks[0]!.to : node.from + 1;
  const to = marks.length > 1 ? marks[marks.length - 1]!.from : node.to - 1;
  return to > from ? { from, to } : null;
}

/** The opening fence line and the copyable body of a `FencedCode` node, or null when there is no body. */
export function fencedBlock(
  state: EditorState,
  node: SyntaxNode,
): { lineFrom: number; lineTo: number; bodyFrom: number; bodyTo: number } | null {
  const text = state.doc.sliceString(node.from, node.to);
  const open = text.indexOf("\n");
  if (open === -1) return null;
  const lastBreak = text.lastIndexOf("\n");
  const bodyTo =
    lastBreak > open && /^\s*(`{3,}|~{3,})\s*$/.test(text.slice(lastBreak + 1))
      ? node.from + lastBreak
      : node.to;
  const bodyFrom = node.from + open + 1;
  if (bodyTo <= bodyFrom) return null;
  const line = state.doc.lineAt(node.from);
  return { lineFrom: line.from, lineTo: line.to, bodyFrom, bodyTo };
}

/** Builds the copy-button decorations plus the outer char ranges of every fenced block (for hover). */
export function buildCopy(
  state: EditorState,
  copy: CopyFn,
): { decorations: DecorationSet; blocks: { from: number; to: number }[] } {
  const ranges: Range<Decoration>[] = [];
  const blocks: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "InlineCode") {
        const inner = inlineCodeInner(node.node);
        if (inner) {
          const text = state.doc.sliceString(inner.from, inner.to);
          ranges.push(
            Decoration.widget({
              widget: new CopyWidget(text, "inline", node.from, copy),
              side: 1,
            }).range(node.to),
          );
        }
        return false;
      }
      if (node.name === "FencedCode") {
        const fb = fencedBlock(state, node.node);
        if (fb) {
          const text = state.doc.sliceString(fb.bodyFrom, fb.bodyTo);
          ranges.push(Decoration.line({ class: "te-copyblock" }).range(fb.lineFrom));
          ranges.push(
            Decoration.widget({
              widget: new CopyWidget(text, "block", node.from, copy),
              side: 1,
            }).range(fb.lineTo),
          );
          blocks.push({ from: node.from, to: node.to });
        }
        return false;
      }
      return undefined;
    },
  });
  return { decorations: Decoration.set(ranges, true), blocks };
}

class CopyPlugin implements PluginValue {
  decorations: DecorationSet;
  private blocks: { from: number; to: number }[];
  /** `node.from` of the block whose button is currently revealed, or -1 for none. */
  private revealed = -1;

  constructor(
    view: EditorView,
    private readonly copy: CopyFn,
  ) {
    const built = buildCopy(view.state, copy);
    this.decorations = built.decorations;
    this.blocks = built.blocks;
  }

  update(u: ViewUpdate): void {
    if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
      const built = buildCopy(u.view.state, this.copy);
      this.decorations = built.decorations;
      this.blocks = built.blocks;
    }
  }

  onHover(event: Event, view: EditorView): void {
    const target = event.target as HTMLElement | null;
    const line = target?.closest?.(".cm-line") ?? null;
    const from = line ? this.blockAt(view, line) : -1;
    if (from === this.revealed) return;
    this.revealed = from;
    this.paint(view);
  }

  clearHover(view: EditorView): void {
    if (this.revealed === -1) return;
    this.revealed = -1;
    this.paint(view);
  }

  private blockAt(view: EditorView, line: Element): number {
    let pos: number;
    try {
      pos = view.posAtDOM(line);
    } catch {
      return -1;
    }
    const block = this.blocks.find((b) => pos >= b.from && pos <= b.to);
    return block ? block.from : -1;
  }

  private paint(view: EditorView): void {
    const target = String(this.revealed);
    for (const node of view.contentDOM.querySelectorAll<HTMLElement>(".te-copy-block"))
      node.classList.toggle("is-visible", node.dataset["from"] === target);
  }
}

/** Hover-revealed copy buttons on inline code and fenced code blocks. `copy` receives the inner text. */
export function copyButtons(copy: CopyFn): ViewPlugin<CopyPlugin> {
  return ViewPlugin.define((view) => new CopyPlugin(view, copy), {
    decorations: (p) => p.decorations,
    eventHandlers: {
      mouseover(event, view) {
        this.onHover(event, view);
      },
      mouseleave(_event, view) {
        this.clearHover(view);
      },
    },
  });
}
