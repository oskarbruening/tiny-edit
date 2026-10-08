import * as fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeRejections, Files, sameStamp } from "../../../src/main/files";

let dir = "";
let files: Files;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tiny-edit-files-"));
  files = new Files(fs);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = (name: string, data: string | Uint8Array) => {
  const p = join(dir, name);
  fs.writeFileSync(p, data);
  return p;
};

describe("Files.read", () => {
  it("returns normalised text, eol, bom and a stamp", async () => {
    const p = write("a.md", "\uFEFFone\r\ntwo\r\n");
    const r = await files.read(p);
    expect(r).toMatchObject({ text: "one\ntwo\n", eol: "\r\n", bom: true, large: false, readOnly: false });
    expect(r.stamp.size).toBe(fs.statSync(p).size);
    expect(r.stamp.mtimeMs).toBe(fs.statSync(p).mtimeMs);
  });
  it("opens a file that is not valid UTF-8 read-only with a lossy rendering, never rewriting it", async () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]); // "café\n" in ISO-8859-1
    const p = write("latin.txt", latin1);
    const r = await files.read(p);
    expect(r.readOnly).toBe(true);
    expect(r.text).toBe("caf\uFFFD\n");
    expect(new Uint8Array(fs.readFileSync(p))).toEqual(latin1);
  });
  it("round-trips a classic Mac (CR) file byte for byte", async () => {
    const p = write("mac.txt", "one\rtwo\r");
    const r = await files.read(p);
    expect(r).toMatchObject({ text: "one\ntwo\n", eol: "\r" });
    await files.write({ path: p, text: r.text + "three\n", eol: r.eol, bom: r.bom });
    expect(fs.readFileSync(p, "utf8")).toBe("one\rtwo\rthree\r");
  });
  it("flags large files", async () => {
    const p = write("big.txt", "x");
    fs.truncateSync(p, 10 * 1024 * 1024 + 1);
    expect((await files.read(p)).large).toBe(true);
  });
  it("rejects for a missing file", async () => {
    await expect(files.read(join(dir, "nope.md"))).rejects.toThrow();
  });
});

describe("Files.write", () => {
  it("writes atomically with eol and bom re-applied, returning the new stamp", async () => {
    const p = write("a.md", "old");
    const before = await files.stat(p);
    const r = await files.write({ path: p, text: "a\nb", eol: "\r\n", bom: true, expected: before });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toBe("\uFEFFa\r\nb");
    expect(fs.readdirSync(dir)).toEqual(["a.md"]);
    if (r.ok) expect(sameStamp(r.stamp, (await files.stat(p))!)).toBe(true);
  });

  it("reports a conflict when the file changed since the expected stamp", async () => {
    const p = write("a.md", "v1");
    const stale = await files.stat(p);
    await new Promise((r) => setTimeout(r, 15));
    fs.writeFileSync(p, "v2 from elsewhere");
    const r = await files.write({ path: p, text: "mine", eol: "\n", bom: false, expected: stale });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflict).toEqual(await files.stat(p));
    expect(fs.readFileSync(p, "utf8")).toBe("v2 from elsewhere");
  });

  it("force overrides the guard", async () => {
    const p = write("a.md", "v1");
    const stale = { mtimeMs: 1, size: 1 };
    const r = await files.write({
      path: p,
      text: "mine",
      eol: "\n",
      bom: false,
      expected: stale,
      force: true,
    });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toBe("mine");
  });

  it("recreates a file deleted underneath instead of conflicting", async () => {
    const p = write("a.md", "v1");
    const stamp = await files.stat(p);
    fs.unlinkSync(p);
    const r = await files.write({ path: p, text: "back", eol: "\n", bom: false, expected: stamp });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toBe("back");
  });

  it("writes without a guard when no expected stamp is given", async () => {
    const p = join(dir, "new.md");
    const r = await files.write({ path: p, text: "x", eol: "\n", bom: false });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(p)).toBe(true);
  });
});

describe("Files.stat", () => {
  it("returns null for missing paths and directories", async () => {
    expect(await files.stat(join(dir, "missing"))).toBeNull();
    expect(await files.stat(dir)).toBeNull();
  });
});

describe("Files.create", () => {
  it("creates an empty .md exclusively", async () => {
    const r = await files.create(dir, "notes");
    expect(r).toEqual({ ok: true, path: join(dir, "notes.md") });
    expect(fs.readFileSync(join(dir, "notes.md"), "utf8")).toBe("");
    expect(await files.create(dir, "notes.md")).toEqual({ ok: false, error: "notes.md already exists" });
  });
  it("rejects bad names, relative or missing folders", async () => {
    expect((await files.create(dir, "")).ok).toBe(false);
    expect(await files.create("relative/dir", "a")).toEqual({
      ok: false,
      error: "Folder must be an absolute path",
    });
    expect(await files.create(join(dir, "nope"), "a")).toEqual({ ok: false, error: "Folder does not exist" });
  });
  it("maps other errors to a generic message", async () => {
    const broken = new Files({
      ...fs,
      promises: {
        ...fs.promises,
        open: async () => {
          throw Object.assign(new Error("x"), { code: "EACCES" });
        },
      },
    } as never);
    expect(await broken.create(dir, "a")).toEqual({ ok: false, error: "Could not create a.md" });
  });
});

describe("Files.accept", () => {
  it("accepts listed extensions and extensionless text; rejects unknown types, non-UTF-8, missing, relative and symlinks", async () => {
    const md = write("a.md", "# hi");
    const py = write("script.py", "print('hi')\n");
    const json = write("data.json", "{}");
    const noExt = write("README", "plain text, no extension");
    const png = write("img.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]));
    const latin = write("latin.txt", new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
    const nul = write("nul.md", new Uint8Array([0x68, 0x00, 0x69]));
    const unknown = write("notes.xyz", "looks like text but the type is unknown");
    const link = join(dir, "link.md");
    fs.symlinkSync(md, link);
    const r = await files.accept([
      md,
      py,
      json,
      noExt,
      png,
      latin,
      nul,
      unknown,
      join(dir, "missing.md"),
      "relative.md",
      link,
      md,
    ]);
    expect(r.added).toEqual([md, py, json, noExt]);
    expect(r.rejected).toEqual([
      { path: png, reason: "extension" },
      { path: latin, reason: "binary" },
      { path: nul, reason: "binary" },
      { path: unknown, reason: "extension" },
      { path: join(dir, "missing.md"), reason: "missing" },
      { path: "relative.md", reason: "not-absolute" },
      { path: link, reason: "symlink" },
    ]);
  });

  it("expands a dropped folder to its direct text children, skipping dotfiles, symlinks and subfolders", async () => {
    const sub = join(dir, "folder");
    fs.mkdirSync(join(sub, "nested"), { recursive: true });
    fs.writeFileSync(join(sub, "nested", "deep.md"), "deep");
    fs.writeFileSync(join(sub, "b.md"), "b");
    fs.writeFileSync(join(sub, "a.txt"), "a");
    fs.writeFileSync(join(sub, ".DS_Store"), "junk");
    fs.writeFileSync(join(sub, "bin.dat"), new Uint8Array([0, 1, 2]));
    fs.writeFileSync(join(sub, "readme"), "plain text, no extension");
    fs.symlinkSync(join(sub, "b.md"), join(sub, "c.md"));
    fs.writeFileSync(join(sub, "photo.jpg"), "not really a photo");
    const r = await files.accept([sub]);
    expect(r.added).toEqual([join(sub, "a.txt"), join(sub, "b.md"), join(sub, "readme")]);
    expect(r.rejected).toEqual([]); // children a folder cannot offer are skipped quietly
  });

  it("rejects special files and non-string entries", async () => {
    const r = await files.accept(["/dev/null", 42 as never]);
    expect(r.rejected).toEqual([
      { path: "/dev/null", reason: "unsupported" },
      { path: "42", reason: "not-absolute" },
    ]);
    expect(r.added).toEqual([]);
  });

  it("resolves . and .. segments", async () => {
    const md = write("a.md", "x");
    const r = await files.accept([join(dir, "sub", "..", "a.md")]);
    expect(r.added).toEqual([md]);
  });
});

describe("describeRejections", () => {
  it("names each refused file with its reason and says what is accepted", () => {
    const one = describeRejections([{ path: "/x/report.pdf", reason: "extension" }]);
    expect(one.message).toBe("Couldn't open this file");
    expect(one.detail).toContain("report.pdf: unsupported file type (.pdf)");
    expect(one.detail).toContain("Tiny Edit opens Markdown, plain text, JSON");
    const many = describeRejections([
      { path: "/x/old.txt", reason: "binary" },
      { path: "/x/gone.md", reason: "missing" },
      { path: "/x/link.md", reason: "symlink" },
      { path: "/dev/null", reason: "unsupported" },
      { path: "rel.md", reason: "not-absolute" },
      { path: "/x/Makefile", reason: "extension" },
    ]);
    expect(many.message).toBe("Couldn't open 6 files");
    expect(many.detail).toContain("old.txt: not UTF-8 text");
    expect(many.detail).toContain("gone.md: file not found");
    expect(many.detail).toContain("link.md: symbolic links are not supported");
    expect(many.detail).toContain("null: not a regular file");
    expect(many.detail).toContain("rel.md: not an absolute path");
    expect(many.detail).toContain("Makefile: unsupported file type (no extension)");
  });
});
