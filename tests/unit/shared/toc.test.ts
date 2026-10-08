import { describe, expect, it } from "vitest";
import { hasOutline, parseToc, type Heading } from "../../../src/shared/toc";

/** Slice a section out of the source to prove from/to line up with the buffer. */
const section = (text: string, h: Heading): string => text.slice(h.from, h.to);

describe("parseToc", () => {
  it("returns H1 and H2 with text and offsets; ignores deeper and marker-only lines", () => {
    const text = ["# One", "body", "## Two", "### Three", "#NoSpace", "#", "## Four"].join("\n");
    const toc = parseToc(text);
    expect(toc.map((h) => [h.level, h.text])).toEqual([
      [1, "One"],
      [2, "Two"],
      [2, "Four"],
    ]);
    expect(section(text, toc[0]!)).toContain("# One");
    expect(text.slice(toc[0]!.from, toc[0]!.from + 5)).toBe("# One");
  });

  it("an H1 section runs to the next H1 and includes nested H2s; an H2 stops at the next heading", () => {
    const text = ["# A", "intro", "## A1", "a1 body", "## A2", "a2 body", "# B", "b body"].join("\n");
    const toc = parseToc(text);
    const [a, a1, a2, b] = toc;
    // A spans through both its H2s up to "# B".
    expect(section(text, a!)).toBe("# A\nintro\n## A1\na1 body\n## A2\na2 body\n");
    expect(section(text, a1!)).toBe("## A1\na1 body\n");
    expect(section(text, a2!)).toBe("## A2\na2 body\n");
    // The last heading runs to the end of the document (no trailing newline here).
    expect(section(text, b!)).toBe("# B\nb body");
    expect(b!.to).toBe(text.length);
  });

  it("skips headings inside fenced code blocks (``` and ~~~), honouring info strings and tildes", () => {
    const text = [
      "# Real",
      "```md",
      "# Fake",
      "## Fake2",
      "```",
      "~~~",
      "## AlsoFake",
      "~~~",
      "## Real2",
    ].join("\n");
    const toc = parseToc(text);
    expect(toc.map((h) => h.text)).toEqual(["Real", "Real2"]);
  });

  it("a fence left unclosed hides everything after it", () => {
    const text = ["# Real", "```", "# Fake"].join("\n");
    expect(parseToc(text).map((h) => h.text)).toEqual(["Real"]);
  });

  it("allows multiple spaces after the hashes and trims the text; empty text is kept", () => {
    const text = ["#   Spaced  ", "## "].join("\n");
    const toc = parseToc(text);
    expect(toc.map((h) => [h.level, h.text])).toEqual([
      [1, "Spaced"],
      [2, ""],
    ]);
  });

  it("recognises setext headings (=== is H1, --- is H2) with the paragraph line as the text", () => {
    const text = ["Title", "=====", "intro", "Section", "---", "body", "## Atx"].join("\n");
    const toc = parseToc(text);
    expect(toc.map((h) => [h.level, h.text])).toEqual([
      [1, "Title"],
      [2, "Section"],
      [2, "Atx"],
    ]);
    expect(section(text, toc[0]!)).toBe(text + ""); // H1 runs to the end: no later H1
    expect(text.slice(toc[1]!.from, toc[1]!.from + 7)).toBe("Section");
    expect(section(text, toc[1]!)).toBe("Section\n---\nbody\n");
  });

  it("does not mistake a thematic break, a list item or a blank line for a setext heading", () => {
    const text = [
      "",
      "---",
      "para",
      "",
      "===",
      "- item",
      "---",
      "> quote",
      "===",
      "# H",
      "---",
      "```",
      "x",
      "```",
      "---",
      "   Indented ok",
      "  ===  ",
    ].join("\n");
    const toc = parseToc(text);
    expect(toc.map((h) => [h.level, h.text])).toEqual([
      [1, "H"],
      [1, "Indented ok"],
    ]);
  });

  it("ignores setext underlines inside fenced code", () => {
    const text = ["```", "Not a title", "===", "```"].join("\n");
    expect(parseToc(text)).toEqual([]);
  });

  it("returns an empty list for text without headings", () => {
    expect(parseToc("just prose\nmore prose")).toEqual([]);
  });
});

describe("hasOutline", () => {
  const h = (level: 1 | 2): Heading => ({ level, text: "x", from: 0, to: 0 });
  it("needs two of the same level", () => {
    expect(hasOutline([])).toBe(false);
    expect(hasOutline([h(1)])).toBe(false);
    expect(hasOutline([h(1), h(2)])).toBe(false); // one of each is not enough
    expect(hasOutline([h(1), h(1)])).toBe(true);
    expect(hasOutline([h(2), h(2)])).toBe(true);
    expect(hasOutline([h(1), h(2), h(2)])).toBe(true);
  });
});
