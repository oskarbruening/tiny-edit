import { describe, expect, it } from "vitest";
import {
  abbreviateHome,
  baseName,
  ACCEPTED_EXTENSIONS,
  HIDDEN_EXTENSIONS,
  decodeUtf8,
  decodeUtf8Lossy,
  formatOf,
  parentDir,
  detectEol,
  displayName,
  extensionOf,
  isAcceptedExtension,
  isHiddenExtension,
  looksLikeText,
  normalizeNewFileName,
  stripBom,
  toEditorText,
  toFileText,
} from "../../../src/shared/text";

describe("extensionOf / isAcceptedExtension / displayName", () => {
  it("finds lower-cased extensions and ignores dotfiles", () => {
    expect(extensionOf("/a/b/Notes.MD")).toBe(".md");
    expect(extensionOf("/a/.gitignore")).toBe("");
    expect(extensionOf("/a/noext")).toBe("");
    expect(extensionOf("C:\\x\\y.TXT")).toBe(".txt");
    expect(extensionOf("/a/b.tar.gz")).toBe(".gz");
  });
  it("accepts Markdown, text, data, config and source extensions; refuses binary-ish and unknown ones", () => {
    for (const p of [
      "a.md",
      "a.markdown",
      "a.txt",
      "a.text",
      "A.MD",
      "a.json",
      "a.yaml",
      "a.csv",
      "a.py",
      "a.ts",
    ])
      expect(isAcceptedExtension(p)).toBe(true);
    for (const p of ["a.png", "a.pdf", "a.zip", "a.docx", "a.bin", "a", ".md", "a.md.bak"])
      expect(isAcceptedExtension(p)).toBe(false);
    expect(new Set(ACCEPTED_EXTENSIONS).size).toBe(ACCEPTED_EXTENSIONS.length); // no duplicates
    for (const ext of ACCEPTED_EXTENSIONS) expect(ext).toMatch(/^\.[a-z0-9]+$/);
    for (const ext of HIDDEN_EXTENSIONS) expect(ACCEPTED_EXTENSIONS).toContain(ext);
  });
  it("maps extensions to a structured format for highlighting and Pretty Format", () => {
    expect(formatOf("/x/a.md")).toBe("markdown");
    expect(formatOf("/x/a.markdown")).toBe("markdown");
    expect(formatOf("/x/a.json")).toBe("json");
    expect(formatOf("/x/a.jsonc")).toBe("json");
    expect(formatOf("/x/a.HTML")).toBe("html");
    expect(formatOf("/x/a.htm")).toBe("html");
    expect(formatOf("/x/a.xml")).toBe("xml");
    expect(formatOf("/x/a.svg")).toBe("xml");
    expect(formatOf("/x/a.yaml")).toBe("yaml");
    expect(formatOf("/x/a.yml")).toBe("yaml");
    // Plain text, source code and TOML have no Pretty Format (TOML still highlights — see topLanguage).
    expect(formatOf("/x/a.txt")).toBeNull();
    expect(formatOf("/x/a.ts")).toBeNull();
    expect(formatOf("/x/a.toml")).toBeNull();
    expect(formatOf("/x/noext")).toBeNull();
  });
  it("hides only the Markdown / text extensions in the sidebar label, keeps the rest visible", () => {
    expect(isHiddenExtension("a.md")).toBe(true);
    expect(isHiddenExtension("a.json")).toBe(false);
    expect(displayName("/x/todo.md")).toBe("todo");
    expect(displayName("/x/notes.TXT")).toBe("notes");
    expect(displayName("/x/config.json")).toBe("config.json");
    expect(displayName("/x/script.py")).toBe("script.py");
    expect(displayName("/x/README")).toBe("README");
    expect(displayName("/x/.md")).toBe(".md");
  });
});

describe("detectEol", () => {
  it("uses the first line break", () => {
    expect(detectEol("a\nb\r\nc")).toBe("\n");
    expect(detectEol("a\r\nb\nc")).toBe("\r\n");
    expect(detectEol("no breaks")).toBe("\n");
    expect(detectEol("")).toBe("\n");
    expect(detectEol("\n")).toBe("\n");
    expect(detectEol("\r\n")).toBe("\r\n");
  });
  it("recognises bare CR (classic Mac) files, and a stray CR in an LF file does not change the verdict", () => {
    expect(detectEol("a\rb\rc")).toBe("\r");
    expect(detectEol("\r")).toBe("\r");
    expect(detectEol("a\rb\nc")).toBe("\r"); // first break is a bare CR
    expect(detectEol("a\nb\rc")).toBe("\n"); // first break is LF; the CR is just a character
  });
});

describe("decodeUtf8", () => {
  it("decodes valid UTF-8 (keeping a BOM) and returns null for invalid bytes", () => {
    expect(decodeUtf8(new TextEncoder().encode("\uFEFFcafé"))).toBe("\uFEFFcafé");
    expect(decodeUtf8(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBeNull(); // Latin-1 "café"
    expect(decodeUtf8(new Uint8Array([0xff, 0xfe, 0x68, 0x00]))).toBeNull(); // UTF-16LE BOM + "h"
    expect(decodeUtf8Lossy(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("caf\uFFFD");
  });
});

describe("BOM and EOL round trip", () => {
  it("strips and re-adds the BOM", () => {
    expect(stripBom("\uFEFFhi")).toEqual({ bom: true, text: "hi" });
    expect(stripBom("hi")).toEqual({ bom: false, text: "hi" });
    expect(toFileText("hi", "\n", true)).toBe("\uFEFFhi");
  });
  it("normalises CRLF and CR to LF for the editor and back", () => {
    expect(toEditorText("a\r\nb\r\n", "\r\n")).toBe("a\nb\n");
    expect(toEditorText("a\rb\r", "\r")).toBe("a\nb\n");
    expect(toEditorText("a\nb\rc", "\n")).toBe("a\nb\rc"); // the stray CR is kept as a character
    expect(toFileText("a\nb\n", "\r\n", false)).toBe("a\r\nb\r\n");
    expect(toFileText("a\nb\n", "\r", false)).toBe("a\rb\r");
    expect(toFileText("a\nb", "\n", false)).toBe("a\nb");
  });
  it("is byte-faithful for consistent files", () => {
    for (const original of [
      "\uFEFFone\r\ntwo\r\n",
      "one\ntwo",
      "",
      "no newline",
      "\n\n\n",
      "mac\rstyle\r",
      "lf\nwith stray\rcr\n",
    ]) {
      const { bom, text } = stripBom(original);
      const eol = detectEol(text);
      expect(toFileText(toEditorText(text, eol), eol, bom)).toBe(original);
    }
  });
});

describe("looksLikeText", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it("accepts UTF-8 text including an empty file", () => {
    expect(looksLikeText(enc(""))).toBe(true);
    expect(looksLikeText(enc("# Hello\n\nwörld — ✓"))).toBe(true);
  });
  it("rejects NUL bytes and invalid UTF-8", () => {
    expect(looksLikeText(new Uint8Array([0x68, 0x00, 0x69]))).toBe(false);
    expect(looksLikeText(new Uint8Array([0xff, 0xfe, 0x41]))).toBe(false);
    expect(looksLikeText(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false); // PNG header
  });
  it("tolerates a multi-byte character cut at the 8 KB boundary", () => {
    const filler = "a".repeat(8 * 1024 - 2);
    const bytes = enc(filler + "€€"); // € is 3 bytes; the sample ends 1 byte into the second €
    expect(bytes.length).toBeGreaterThan(8 * 1024);
    expect(looksLikeText(bytes)).toBe(true);
  });
  it("does not tolerate invalid bytes just because the sample is full", () => {
    const bytes = new Uint8Array(8 * 1024 + 10).fill(0x61);
    bytes[100] = 0xff;
    expect(looksLikeText(bytes)).toBe(false);
  });
});

describe("normalizeNewFileName", () => {
  it("appends .md when there is no extension", () => {
    expect(normalizeNewFileName("  notes ")).toEqual({ ok: true, name: "notes.md" });
    expect(normalizeNewFileName("notes.txt")).toEqual({ ok: true, name: "notes.txt" });
    expect(normalizeNewFileName("v1.2")).toEqual({ ok: true, name: "v1.2" });
  });
  it("rejects empty, dot-only and path-like names", () => {
    expect(normalizeNewFileName("   ").ok).toBe(false);
    expect(normalizeNewFileName("..").ok).toBe(false);
    expect(normalizeNewFileName("a/b").ok).toBe(false);
    expect(normalizeNewFileName("a\\b").ok).toBe(false);
  });
});

describe("parentDir", () => {
  it("returns the directory part, or / for root-level files", () => {
    expect(parentDir("/Users/me/notes/a.md")).toBe("/Users/me/notes");
    expect(parentDir("/a.md")).toBe("/");
    expect(parentDir("a.md")).toBe("/");
  });
});

describe("baseName", () => {
  it("returns the final segment with its extension, for either separator", () => {
    expect(baseName("/Users/me/notes/a.md")).toBe("a.md");
    expect(baseName("a.md")).toBe("a.md");
    expect(baseName("C:\\x\\y.txt")).toBe("y.txt");
  });
});

describe("abbreviateHome", () => {
  it("replaces a leading home directory with ~, otherwise leaves the path", () => {
    expect(abbreviateHome("/Users/me/work", "/Users/me")).toBe("~/work");
    expect(abbreviateHome("/Users/me", "/Users/me")).toBe("~");
    expect(abbreviateHome("/etc/hosts", "/Users/me")).toBe("/etc/hosts");
    expect(abbreviateHome("/Users/メモ", "")).toBe("/Users/メモ");
  });
});
