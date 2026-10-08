import * as fs from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tempPathFor, writeAtomic, writeAtomicSync } from "../../../src/main/atomicWrite";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tiny-edit-atomic-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("tempPathFor", () => {
  it("stays in the target's directory and is unique per call", () => {
    const a = tempPathFor("/x/y/state.json");
    const b = tempPathFor("/x/y/state.json");
    expect(a.startsWith("/x/y/.state.json.tmp-")).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("writeAtomicSync", () => {
  it("creates parent directories, writes, and leaves no temp file", () => {
    const target = join(dir, "nested", "deeper", "state.json");
    writeAtomicSync(fs, target, "hello");
    expect(fs.readFileSync(target, "utf8")).toBe("hello");
    expect(fs.readdirSync(join(dir, "nested", "deeper"))).toEqual(["state.json"]);
  });

  it("replaces existing content whole", () => {
    const target = join(dir, "s.json");
    writeAtomicSync(fs, target, "a".repeat(1000));
    writeAtomicSync(fs, target, "b");
    expect(fs.readFileSync(target, "utf8")).toBe("b");
  });

  it("cleans up the temp file and rethrows when rename fails", () => {
    const target = join(dir, "s.json");
    const broken = {
      ...fs,
      renameSync: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    expect(() => writeAtomicSync(broken as never, target, "x")).toThrow("boom");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("rethrows when the write itself fails even if there is nothing to clean", () => {
    const target = join(dir, "s.json");
    const broken = {
      ...fs,
      writeFileSync: vi.fn(() => {
        throw new Error("disk full");
      }),
      unlinkSync: vi.fn(() => {
        throw new Error("ENOENT");
      }),
    };
    expect(() => writeAtomicSync(broken as never, target, "x")).toThrow("disk full");
  });
});

describe("writeAtomic", () => {
  it("writes asynchronously with no temp residue", async () => {
    const target = join(dir, "a", "state.json");
    await writeAtomic(fs, target, "{}");
    expect(await readFile(target, "utf8")).toBe("{}");
    expect(await readdir(join(dir, "a"))).toEqual(["state.json"]);
  });

  it("keeps the target's permission bits across the rename (a private note stays private)", async () => {
    const target = join(dir, "private.md");
    fs.writeFileSync(target, "secret", { mode: 0o600 });
    await writeAtomic(fs, target, "secret 2");
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    const exec = join(dir, "run.sh");
    fs.writeFileSync(exec, "#!/bin/sh", { mode: 0o755 });
    await writeAtomic(fs, exec, "#!/bin/sh\necho hi");
    expect(fs.statSync(exec).mode & 0o777).toBe(0o755);
  });

  it("fsyncs the temp file before renaming", async () => {
    const target = join(dir, "s.json");
    const synced: string[] = [];
    const spied = {
      ...fs,
      promises: {
        ...fs.promises,
        open: async (...args: Parameters<typeof fs.promises.open>) => {
          const handle = await fs.promises.open(...args);
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            synced.push("sync");
            await sync();
          };
          return handle;
        },
      },
    };
    await writeAtomic(spied as never, target, "x");
    expect(synced).toEqual(["sync"]);
    expect(await readFile(target, "utf8")).toBe("x");
  });

  it("cleans up and rethrows on rename failure", async () => {
    const target = join(dir, "s.json");
    const broken = {
      ...fs,
      promises: {
        ...fs.promises,
        rename: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
    };
    await expect(writeAtomic(broken as never, target, "x")).rejects.toThrow("boom");
    expect(await readdir(dir)).toEqual([]);
  });

  it("swallows a failed cleanup and still rethrows the original error", async () => {
    const target = join(dir, "s.json");
    const broken = {
      ...fs,
      promises: {
        ...fs.promises,
        open: vi.fn(async () => {
          throw new Error("disk full");
        }),
        unlink: vi.fn(async () => {
          throw new Error("ENOENT");
        }),
      },
    };
    await expect(writeAtomic(broken as never, target, "x")).rejects.toThrow("disk full");
  });
});
