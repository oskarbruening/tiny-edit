import type * as Fs from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  ACCEPTED_FORMATS_SUMMARY,
  decodeUtf8,
  decodeUtf8Lossy,
  detectEol,
  extensionOf,
  isAcceptedExtension,
  looksLikeText,
  normalizeNewFileName,
  stripBom,
  toEditorText,
  toFileText,
  type Eol,
} from "../shared/text";
import { writeAtomic, type AtomicFs } from "./atomicWrite";

export type FilesFs = AtomicFs & {
  promises: AtomicFs["promises"] & Pick<typeof Fs.promises, "readFile" | "lstat" | "readdir">;
};

export type FileStamp = { mtimeMs: number; size: number };

/**
 * `readOnly` is true when the bytes are not valid UTF-8: `text` is then a lossy rendering for
 * display only and must never be written back (it would replace the bad bytes with U+FFFD).
 */
export type ReadResult = {
  text: string;
  eol: Eol;
  bom: boolean;
  stamp: FileStamp;
  large: boolean;
  readOnly: boolean;
};

export type WriteRequest = {
  path: string;
  text: string;
  eol: Eol;
  bom: boolean;
  /** Stamp from the last read/write; a mismatch on disk is a conflict unless `force`. */
  expected?: FileStamp | null;
  force?: boolean;
};

export type WriteResult = { ok: true; stamp: FileStamp } | { ok: false; conflict: FileStamp };

/** Why a dropped/opened path was refused. `extension`: unknown type; `binary`: not UTF-8 text. */
export type RejectReason = "not-absolute" | "missing" | "symlink" | "binary" | "extension" | "unsupported";
export type Rejection = { path: string; reason: RejectReason };
export type AcceptResult = { added: string[]; rejected: Rejection[] };

export type CreateResult = { ok: true; path: string } | { ok: false; error: string };

const LARGE_FILE_BYTES = 10 * 1024 * 1024;

export function stampOf(st: { mtimeMs: number; size: number }): FileStamp {
  return { mtimeMs: st.mtimeMs, size: st.size };
}

export function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

const REASON_TEXT: Record<RejectReason, (path: string) => string> = {
  extension: (p) => `unsupported file type (${extensionOf(p) || "no extension"})`,
  binary: () => "not UTF-8 text",
  missing: () => "file not found",
  symlink: () => "symbolic links are not supported",
  "not-absolute": () => "not an absolute path",
  unsupported: () => "not a regular file",
};

/** Wording for the native "couldn't open" dialog: one line per refused path, plus what is accepted. */
export function describeRejections(rejected: readonly Rejection[]): { message: string; detail: string } {
  const lines = rejected.map((r) => `${basename(r.path) || r.path}: ${REASON_TEXT[r.reason](r.path)}`);
  const message =
    rejected.length === 1 ? "Couldn't open this file" : `Couldn't open ${rejected.length} files`;
  const detail = `${lines.join("\n")}\n\nTiny Edit opens ${ACCEPTED_FORMATS_SUMMARY}.`;
  return { message, detail };
}

export class Files {
  constructor(private readonly fs: FilesFs) {}

  async stat(path: string): Promise<FileStamp | null> {
    try {
      const st = await this.fs.promises.stat(path);
      return st.isFile() ? stampOf(st) : null;
    } catch {
      return null;
    }
  }

  /**
   * Reads as strict UTF-8, strips a BOM, normalises the file's line ending to LF. Invalid UTF-8
   * comes back `readOnly` with a lossy rendering, so the bytes on disk are never rewritten.
   */
  async read(path: string): Promise<ReadResult> {
    const [buf, st] = await Promise.all([this.fs.promises.readFile(path), this.fs.promises.stat(path)]);
    const strict = decodeUtf8(buf);
    const raw = strict ?? decodeUtf8Lossy(buf);
    const { bom, text: unBommed } = stripBom(raw);
    const eol = detectEol(unBommed);
    return {
      text: toEditorText(unBommed, eol),
      eol,
      bom,
      stamp: stampOf(st),
      large: st.size > LARGE_FILE_BYTES,
      readOnly: strict === null,
    };
  }

  /**
   * Atomic write with the mtime/size guard. A missing file is recreated (the user kept
   * typing after an external delete), never reported as a conflict.
   */
  async write(req: WriteRequest): Promise<WriteResult> {
    if (req.expected && !req.force) {
      const current = await this.stat(req.path);
      if (current && !sameStamp(current, req.expected)) return { ok: false, conflict: current };
    }
    await writeAtomic(this.fs, req.path, toFileText(req.text, req.eol, req.bom));
    const st = await this.fs.promises.stat(req.path);
    return { ok: true, stamp: stampOf(st) };
  }

  /** Creates an empty file exclusively; fails if it exists. */
  async create(dir: string, rawName: string): Promise<CreateResult> {
    const named = normalizeNewFileName(rawName);
    if (!named.ok) return named;
    if (!isAbsolute(dir)) return { ok: false, error: "Folder must be an absolute path" };
    const path = join(dir, named.name);
    try {
      const handle = await this.fs.promises.open(path, "wx");
      await handle.close();
      return { ok: true, path };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return { ok: false, error: `${named.name} already exists` };
      if (code === "ENOENT") return { ok: false, error: "Folder does not exist" };
      return { ok: false, error: `Could not create ${named.name}` };
    }
  }

  /**
   * Which of these dropped/opened paths become sidebar entries. Files: an accepted extension (or
   * none) and a UTF-8 text sniff. Directories: direct children only, skipping dotfiles, symlinks
   * and refused children silently, sorted by name.
   */
  async accept(paths: readonly string[]): Promise<AcceptResult> {
    const result: AcceptResult = { added: [], rejected: [] };
    const seen = new Set<string>();
    const push = (p: string) => {
      if (!seen.has(p)) {
        seen.add(p);
        result.added.push(p);
      }
    };
    for (const raw of paths) {
      if (typeof raw !== "string" || !isAbsolute(raw)) {
        result.rejected.push({ path: String(raw), reason: "not-absolute" });
        continue;
      }
      const path = resolve(raw);
      let st: Fs.Stats;
      try {
        st = await this.fs.promises.lstat(path);
      } catch {
        result.rejected.push({ path, reason: "missing" });
        continue;
      }
      if (st.isSymbolicLink()) {
        result.rejected.push({ path, reason: "symlink" });
      } else if (st.isDirectory()) {
        for (const child of await this.directChildren(path)) push(child);
      } else if (st.isFile()) {
        const verdict = await this.classify(path);
        if (verdict === null) push(path);
        else result.rejected.push({ path, reason: verdict });
      } else {
        result.rejected.push({ path, reason: "unsupported" });
      }
    }
    return result;
  }

  private async directChildren(dir: string): Promise<string[]> {
    const entries = await this.fs.promises.readdir(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, e.name);
      if ((await this.classify(path)) === null) out.push(path);
    }
    return out;
  }

  /** `null` when the file may be opened, otherwise why not. */
  async classify(path: string): Promise<"extension" | "binary" | null> {
    const base = basename(path);
    if (extensionOf(base) && !isAcceptedExtension(base)) return "extension";
    return (await this.isText(path)) ? null : "binary";
  }

  /** The first SNIFF_BYTES must look like UTF-8 text (no NUL, valid encoding). */
  async isText(path: string): Promise<boolean> {
    const handle = await this.fs.promises.open(path, "r");
    try {
      const buf = new Uint8Array(8 * 1024);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      return looksLikeText(buf.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }
}
