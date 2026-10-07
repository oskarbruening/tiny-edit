/** Pure text helpers shared by main and renderer. No Node or DOM imports. */

export type Eol = "\n" | "\r\n";

export const ACCEPTED_EXTENSIONS = [".md", ".markdown", ".txt", ".text"] as const;
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

/** Sidebar label: basename without an accepted extension. Other extensions stay visible. */
export function displayName(path: string): string {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const ext = extensionOf(base);
  return isAcceptedExtension(base) ? base.slice(0, base.length - ext.length) : base;
}

/** The dominant line ending: whatever the first line break uses. No line break → LF. */
export function detectEol(text: string): Eol {
  const i = text.indexOf("\n");
  if (i === -1) return "\n";
  return i > 0 && text.charCodeAt(i - 1) === 13 ? "\r\n" : "\n";
}

export function stripBom(text: string): { bom: boolean; text: string } {
  return text.startsWith(BOM) ? { bom: true, text: text.slice(1) } : { bom: false, text };
}

/** Normalise a file's text for the editor: CRLF → LF when the file is CRLF. */
export function toEditorText(text: string, eol: Eol): string {
  return eol === "\r\n" ? text.replace(/\r\n/g, "\n") : text;
}

/** Inverse of toEditorText, plus the BOM when the file had one. */
export function toFileText(text: string, eol: Eol, bom: boolean): string {
  const body = eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
  return bom ? BOM + body : body;
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
