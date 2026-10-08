/** Pure text helpers shared by main and renderer. No Node or DOM imports. */

export type Eol = "\n" | "\r\n" | "\r";

/**
 * File types the app opens, by extension (lower-case, with dot). Anything else is refused with
 * a dialog. A file without an extension is accepted when its first SNIFF_BYTES are UTF-8 text.
 */
export const ACCEPTED_EXTENSIONS = [
  // Markdown and plain text
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".text",
  ".log",
  ".rst",
  ".adoc",
  ".org",
  // Data and config
  ".json",
  ".jsonc",
  ".json5",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".properties",
  ".csv",
  ".tsv",
  ".xml",
  ".plist",
  // Web
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".svg",
  // Code
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".sql",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".lua",
  ".r",
  ".pl",
  ".ps1",
  ".bat",
  ".diff",
  ".patch",
  ".tex",
  ".bib",
] as const;

/** Extensions the sidebar hides (the file's own name is the label). Others stay visible. */
export const HIDDEN_EXTENSIONS = [".md", ".markdown", ".txt", ".text"] as const;

/** Human wording for the "unsupported file" dialog: the families the extension list covers. */
export const ACCEPTED_FORMATS_SUMMARY =
  "Markdown, plain text, JSON, YAML, TOML, CSV, XML, HTML, CSS and common source-code files, plus files without an extension that contain UTF-8 text";

export const SNIFF_BYTES = 8 * 1024;
export const LARGE_FILE_BYTES = 10 * 1024 * 1024;

const BOM = "﻿";

/** Extension (lower-cased, with dot) or "" when there is none. A leading dot alone is not an extension. */
export function extensionOf(path: string): string {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/** Directory part of an absolute path ("/" for root-level files). */
export function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i <= 0 ? "/" : path.slice(0, i);
}

export function isAcceptedExtension(path: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(path));
}

export function isHiddenExtension(path: string): boolean {
  return (HIDDEN_EXTENSIONS as readonly string[]).includes(extensionOf(path));
}

/** Sidebar label: basename without a hidden (Markdown / text) extension. Other extensions stay visible. */
export function displayName(path: string): string {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const ext = extensionOf(base);
  return isHiddenExtension(base) ? base.slice(0, base.length - ext.length) : base;
}

/**
 * The dominant line ending: whatever the first line break uses (CRLF, LF, or a bare CR for
 * classic Mac files). No line break → LF.
 */
export function detectEol(text: string): Eol {
  const lf = text.indexOf("\n");
  const cr = text.indexOf("\r");
  if (lf === -1 && cr === -1) return "\n";
  if (cr === -1) return "\n";
  if (lf === -1) return "\r";
  if (cr < lf) return cr === lf - 1 ? "\r\n" : "\r";
  return "\n";
}

export function stripBom(text: string): { bom: boolean; text: string } {
  return text.startsWith(BOM) ? { bom: true, text: text.slice(1) } : { bom: false, text };
}

/**
 * Normalise a file's text for the editor: the file's own line ending becomes LF. A stray `\r`
 * in an LF file stays in the text (the editor splits lines on LF only), so it survives a save.
 */
export function toEditorText(text: string, eol: Eol): string {
  if (eol === "\r\n") return text.replace(/\r\n/g, "\n");
  if (eol === "\r") return text.replace(/\r/g, "\n");
  return text;
}

/** Inverse of toEditorText, plus the BOM when the file had one. */
export function toFileText(text: string, eol: Eol, bom: boolean): string {
  const body = eol === "\n" ? text : text.replace(/\n/g, eol);
  return bom ? BOM + body : body;
}

/** Strict UTF-8 decode: `null` when the bytes are not valid UTF-8 (the text would be lossy). */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    // ignoreBOM keeps the BOM in the string so stripBom can record and later restore it.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Lossy UTF-8 decode (U+FFFD for bad bytes), for showing an invalid file read-only. */
export function decodeUtf8Lossy(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

/**
 * Text sniff on the first SNIFF_BYTES: no NUL byte and valid UTF-8. A multi-byte
 * sequence cut by the sample boundary is tolerated by retrying without the last 1–3 bytes.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, SNIFF_BYTES);
  if (sample.includes(0)) return false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let trim = 0; trim <= 3 && trim <= sample.length; trim++) {
    try {
      decoder.decode(sample.subarray(0, sample.length - trim));
      return true;
    } catch {
      if (sample.length < SNIFF_BYTES) return false; // whole file seen: it really is invalid
    }
  }
  return false;
}

/** New-file name rules: no separators, not empty/dot-only, `.md` appended when there is no extension. */
export function normalizeNewFileName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim();
  if (!name) return { ok: false, error: "Enter a file name" };
  if (/[/\\]/.test(name)) return { ok: false, error: "File name cannot contain / or \\" };
  if (/^\.+$/.test(name)) return { ok: false, error: "That is not a valid file name" };
  return { ok: true, name: extensionOf(name) ? name : `${name}.md` };
}
