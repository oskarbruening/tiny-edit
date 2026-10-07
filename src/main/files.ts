import type * as Fs from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  detectEol,
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
  promises: AtomicFs["promises"] &
    Pick<typeof Fs.promises, "readFile" | "stat" | "lstat" | "readdir" | "open">;
};

export type FileStamp = { mtimeMs: number; size: number };

export type ReadResult = { text: string; eol: Eol; bom: boolean; stamp: FileStamp; large: boolean };

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

export type RejectReason = "not-absolute" | "missing" | "symlink" | "binary" | "unsupported";
export type AcceptResult = { added: string[]; rejected: { path: string; reason: RejectReason }[] };

export type CreateResult = { ok: true; path: string } | { ok: false; error: string };

const LARGE_FILE_BYTES = 10 * 1024 * 1024;

export function stampOf(st: { mtimeMs: number; size: number }): FileStamp {
  return { mtimeMs: st.mtimeMs, size: st.size };
}

export function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
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

  /** Reads as UTF-8 (lossy on invalid bytes), strips a BOM, normalises CRLF → LF. */
  async read(path: string): Promise<ReadResult> {
    const [buf, st] = await Promise.all([this.fs.promises.readFile(path), this.fs.promises.stat(path)]);
    // ignoreBOM keeps the BOM in the string so stripBom can record and later restore it.
    const raw = new TextDecoder("utf-8", { ignoreBOM: true }).decode(buf);
    const { bom, text: unBommed } = stripBom(raw);
    const eol = detectEol(unBommed);
    return {
      text: toEditorText(unBommed, eol),
      eol,
      bom,
      stamp: stampOf(st),
      large: st.size > LARGE_FILE_BYTES,
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
   * Which of these dropped/opened paths become sidebar entries. Files: accepted extension or
   * text sniff. Directories: direct children only, skipping dotfiles and symlinks, sorted by name.
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
        if (await this.isText(path)) push(path);
        else result.rejected.push({ path, reason: "binary" });
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
      if (await this.isText(path)) out.push(path);
    }
    return out;
  }

  /** Accepted extension short-circuits the sniff; everything else must look like UTF-8 text. */
  async isText(path: string): Promise<boolean> {
    if (isAcceptedExtension(basename(path))) return true;
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
