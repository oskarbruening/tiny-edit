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
        writeFile: vi.fn(async () => {
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
