import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { icon, svgEl as el } from "./svg";

/** Opens a URL somewhere (the default browser, via IPC; a spy in tests). */
export type OpenFn = (url: string) => void;

/** A Markdown link (or autolink) the user can open: its char range and the destination URL. */
export type LinkTarget = { from: number; to: number; url: string };

const OPENABLE = new Set(["https:", "http:", "mailto:"]);

/** True when `raw` is an absolute http(s)/mailto URL — the only destinations we offer to open. */
export function isOpenableUrl(raw: string): boolean {
  try {
    return OPENABLE.has(new URL(raw).protocol);
  } catch {
    return false;
  }
}

/** Markdown destinations may be wrapped in angle brackets (`[t](<url>)`, `<url>`); unwrap and trim. */
function cleanUrl(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed;
}

const openIcon = (): SVGSVGElement =>
  icon(
    el("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }),
    el("path", { d: "M15 3h6v6" }),
    el("path", { d: "M10 14 21 3" }),
  );

class OpenLinkWidget extends WidgetType {
  constructor(
    private readonly url: string,
    private readonly from: number,
    private readonly open: OpenFn,
  ) {
    super();
  }

  override eq(other: OpenLinkWidget): boolean {
    return other.url === this.url && other.from === this.from;
  }

  override toDOM(): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "te-copy te-open-link";
    btn.contentEditable = "false";
    btn.title = "Open link (⌘-click)";
    btn.setAttribute("aria-label", "Open link");
    btn.append(openIcon());
    // Keep the click from moving the caret into the text or blurring the editor.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      this.open(this.url);
    });
    // A zero-size anchor keeps the floating button out of the text flow (no layout shift).
    const anchor = document.createElement("span");
    anchor.className = "te-copy-anchor";
    anchor.append(btn);
    return anchor;
  }
}

/** Every openable link/autolink in the document: a `Link` with an openable destination, or a bare autolink. */
export function linkTargets(state: EditorState): LinkTarget[] {
  const targets: LinkTarget[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Link") {
        const urlNode = node.node.getChild("URL");
        if (urlNode) {
          const url = cleanUrl(state.doc.sliceString(urlNode.from, urlNode.to));
          if (isOpenableUrl(url)) targets.push({ from: node.from, to: node.to, url });
        }
        return false; // don't descend into the link's own URL child
      }
      // Images embed, they don't navigate; skip their subtree so the image URL gets no icon.
      if (node.name === "Image") return false;
      if (node.name === "URL") {
        // Standalone URL: an autolink (<url>) or a reference-definition destination.
        const url = cleanUrl(state.doc.sliceString(node.from, node.to));
        if (isOpenableUrl(url)) targets.push({ from: node.from, to: node.to, url });
        return false;
      }
      return undefined;
    },
  });
  return targets;
}

function buildDecorations(targets: LinkTarget[], open: OpenFn): DecorationSet {
  const ranges: Range<Decoration>[] = targets.map((t) =>
    Decoration.widget({ widget: new OpenLinkWidget(t.url, t.from, open), side: 1 }).range(t.to),
  );
  return Decoration.set(ranges, true);
}

class LinkPlugin implements PluginValue {
  decorations: DecorationSet;
  private targets: LinkTarget[];

  constructor(
    view: EditorView,
    private readonly open: OpenFn,
  ) {
    this.targets = linkTargets(view.state);
    this.decorations = buildDecorations(this.targets, open);
  }

  update(u: ViewUpdate): void {
    if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
      this.targets = linkTargets(u.state);
      this.decorations = buildDecorations(this.targets, this.open);
    }
  }

  /** Cmd+click (primary button) anywhere on a link opens it; other clicks fall through to the editor. */
  onMouseDown(event: MouseEvent, view: EditorView): boolean {
    if (!event.metaKey || event.button !== 0) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const target = this.targets.find((t) => pos >= t.from && pos <= t.to);
    if (!target) return false;
    event.preventDefault();
    this.open(target.url);
    return true;
  }
}

/** Hover-revealed open-link buttons on Markdown links/autolinks, plus Cmd+click to open. `open` receives the URL. */
export function openLinks(open: OpenFn): ViewPlugin<LinkPlugin> {
  return ViewPlugin.define((view) => new LinkPlugin(view, open), {
    decorations: (p) => p.decorations,
    eventHandlers: {
      mousedown(event, view) {
        return this.onMouseDown(event, view);
      },
    },
  });
}
