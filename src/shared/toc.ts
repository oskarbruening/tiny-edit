/** Table-of-contents parsing shared by the sidebar and the editor. No Node or DOM imports.
 *
 * A heading is a line that starts with `# ` or `## ` (exactly one or two `#` then a space), or
 * a setext heading: a paragraph line underlined with `===` (H1) or `---` (H2). `###` and deeper
 * are ignored, as the outline only flattens H1 and H2. Markers inside a fenced code block
 * (``` or ~~~) are never headings. Offsets are into the editor buffer (LF), so they map
 * straight onto CodeMirror positions.
 */

export type HeadingLevel = 1 | 2;

export type Heading = {
  level: HeadingLevel;
  /** Heading text without the leading `#`s, trimmed. May be empty. */
  text: string;
  /** Character offset of the heading line's first `#`. */
  from: number;
  /**
   * Character offset where this heading's section ends: the start of the next heading whose
   * level is the same or higher (an H1 for an H1; an H1 or H2 for an H2), or the end of the
   * document. So an H1's section includes the H2s nested under it.
   */
  to: number;
};

/** Leading whitespace then a run of 3+ backticks or tildes (a fence open or close). */
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
/** One or two `#` then at least one space, then the (possibly empty) heading text. */
const HEADING = /^(#{1,2}) +(.*)$/;
/** A setext underline: up to three spaces of indent, then only `=` or only `-`, then spaces. */
const SETEXT = /^ {0,3}(=+|-+) *$/;
/** A line that cannot be the text of a setext heading (blank, or the start of another block). */
const NOT_PARAGRAPH = /^(\s*$| {0,3}(#|>|[-*+] |\d+[.)] |`{3,}|~{3,}|---+\s*$|\*\*\*+\s*$|___+\s*$))/;

/** All H1/H2 headings outside fenced code, in document order, with their section ranges. */
export function parseToc(text: string): Heading[] {
  const found: Array<Omit<Heading, "to">> = [];
  const lines = text.split("\n");
  let offset = 0;
  let fence: string | null = null; // the opening fence's marker run, e.g. "```"
  /** The previous line when it can carry a setext underline: its text and start offset. */
  let paragraph: { text: string; from: number } | null = null;

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      // A closing fence uses the same marker character, is at least as long, and carries no info.
      if (fenceMatch && fenceMatch[2]![0] === fence[0] && fenceMatch[2]!.length >= fence.length) fence = null;
      paragraph = null;
    } else if (fenceMatch) {
      fence = fenceMatch[2]!;
      paragraph = null;
    } else {
      const headingMatch = HEADING.exec(line);
      const setext = paragraph && SETEXT.exec(line);
      if (headingMatch) {
        found.push({
          level: headingMatch[1]!.length as HeadingLevel,
          text: headingMatch[2]!.trim(),
          from: offset,
        });
        paragraph = null;
      } else if (setext && paragraph) {
        found.push({ level: setext[1]![0] === "=" ? 1 : 2, text: paragraph.text, from: paragraph.from });
        paragraph = null;
      } else {
        paragraph = NOT_PARAGRAPH.test(line) ? null : { text: line.trim(), from: offset };
      }
    }
    offset += line.length + 1; // +1 for the "\n" that split() removed
  }

  return found.map((h, i) => {
    let to = text.length;
    for (let j = i + 1; j < found.length; j++)
      if (found[j]!.level <= h.level) {
        to = found[j]!.from;
        break;
      }
    return { ...h, to };
  });
}

/** Whether a file earns a TOC chevron: at least two H1s or at least two H2s. */
export function hasOutline(headings: readonly Heading[]): boolean {
  let h1 = 0;
  let h2 = 0;
  for (const h of headings) {
    if (h.level === 1) h1++;
    else h2++;
  }
  return h1 >= 2 || h2 >= 2;
}
