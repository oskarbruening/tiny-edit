import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editorExtensions } from "../../../../src/renderer/editor/extensions";
import { isOpenableUrl, linkTargets, openLinks, type OpenFn } from "../../../../src/renderer/editor/links";

const views: EditorView[] = [];
afterEach(() => {
  views.splice(0).forEach((v) => v.destroy());
});

function view(doc: string, open: OpenFn = () => undefined) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const plugin = openLinks(open);
  const v = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: editorExtensions([plugin]) }),
  });
  views.push(v);
  return { v, plugin };
}

describe("isOpenableUrl", () => {
  it("accepts http(s) and mailto, rejects everything else", () => {
    expect(isOpenableUrl("https://example.com")).toBe(true);
    expect(isOpenableUrl("http://example.com")).toBe(true);
    expect(isOpenableUrl("mailto:a@b.com")).toBe(true);
    expect(isOpenableUrl("ftp://example.com")).toBe(false);
    expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableUrl("./relative.md")).toBe(false);
    expect(isOpenableUrl("#fragment")).toBe(false);
    expect(isOpenableUrl("not a url")).toBe(false);
  });
});

describe("linkTargets", () => {
  it("limits the search to the given ranges without duplicating a link seen twice", () => {
    const doc = "[a](https://a.example)\n\nplain\n\n[b](https://b.example)";
    const { v } = view(doc);
    expect(linkTargets(v.state).map((t) => t.url)).toEqual(["https://a.example", "https://b.example"]);
    expect(linkTargets(v.state, [{ from: 0, to: 5 }]).map((t) => t.url)).toEqual(["https://a.example"]);
    expect(
      linkTargets(v.state, [
        { from: 0, to: 3 },
        { from: 2, to: 6 },
      ]).map((t) => t.url),
    ).toEqual(["https://a.example"]);
    expect(linkTargets(v.state, [{ from: 24, to: 29 }])).toEqual([]);
  });

  it("finds a Markdown link's whole construct and its destination", () => {
    const { v } = view("see [the site](https://example.com) now");
    const targets = linkTargets(v.state);
    expect(targets).toHaveLength(1);
    expect(v.state.doc.sliceString(targets[0]!.from, targets[0]!.to)).toBe("[the site](https://example.com)");
    expect(targets[0]!.url).toBe("https://example.com");
  });

  it("finds autolinks", () => {
    const { v } = view("ping <https://example.com> here");
    const targets = linkTargets(v.state);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.url).toBe("https://example.com");
  });

  it("accepts mailto links", () => {
    const { v } = view("[mail](mailto:a@b.com)");
    expect(linkTargets(v.state)[0]!.url).toBe("mailto:a@b.com");
  });

  it("ignores relative and fragment destinations", () => {
    const { v } = view("[rel](./other.md) and [frag](#section)");
    expect(linkTargets(v.state)).toHaveLength(0);
  });

  it("ignores image destinations", () => {
    const { v } = view("![alt](https://example.com/pic.png)");
    expect(linkTargets(v.state)).toHaveLength(0);
  });
});

describe("open-link button", () => {
  it("renders a hover open-link button after each openable link", () => {
    const { v } = view("[site](https://example.com)");
    const btn = v.contentDOM.querySelector<HTMLButtonElement>(".te-open-link")!;
    expect(btn).toBeTruthy();
    expect(btn.closest(".te-copy-anchor")).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toBe("Open link");
  });

  it("opens the destination on click", () => {
    const open = vi.fn();
    const { v } = view("[site](https://example.com)", open);
    v.contentDOM.querySelector<HTMLButtonElement>(".te-open-link")!.click();
    expect(open).toHaveBeenCalledWith("https://example.com");
  });

  it("rebuilds decorations as the document changes", () => {
    const { v } = view("plain text");
    expect(v.contentDOM.querySelectorAll(".te-open-link")).toHaveLength(0);
    v.dispatch({ changes: { from: v.state.doc.length, insert: " [x](https://example.com)" } });
    expect(v.contentDOM.querySelectorAll(".te-open-link")).toHaveLength(1);
  });
});

describe("Cmd+click", () => {
  type Instance = { onMouseDown(e: MouseEvent, v: EditorView): boolean };
  function mouse(): MouseEvent & { prevented: boolean } {
    const ev = {
      metaKey: true,
      button: 0,
      clientX: 0,
      clientY: 0,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    return ev as unknown as MouseEvent & { prevented: boolean };
  }

  it("opens the link under a Cmd+primary click and swallows the event", () => {
    const open = vi.fn();
    const { v, plugin } = view("see [site](https://example.com) ok", open);
    const inst = v.plugin(plugin as never) as unknown as Instance;
    v.posAtCoords = () => 7; // inside [site]
    const ev = mouse();
    expect(inst.onMouseDown(ev, v)).toBe(true);
    expect(ev.prevented).toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com");
  });

  it("ignores clicks without Cmd, non-primary buttons, misses, and unresolvable coords", () => {
    const open = vi.fn();
    const { v, plugin } = view("see [site](https://example.com) ok", open);
    const inst = v.plugin(plugin as never) as unknown as Instance;

    v.posAtCoords = () => 7;
    expect(inst.onMouseDown({ metaKey: false, button: 0 } as unknown as MouseEvent, v)).toBe(false);
    expect(inst.onMouseDown({ metaKey: true, button: 2 } as unknown as MouseEvent, v)).toBe(false);

    v.posAtCoords = () => 0; // in "see ", before the link
    expect(inst.onMouseDown(mouse(), v)).toBe(false);

    v.posAtCoords = (() => null) as unknown as typeof v.posAtCoords;
    expect(inst.onMouseDown(mouse(), v)).toBe(false);

    expect(open).not.toHaveBeenCalled();
  });
});
