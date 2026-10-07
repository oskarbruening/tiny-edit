import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("files flow through window.api: add, read, write with guard, conflict, create", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-files-e2e-"));
  const { app, close } = await launchApp();
  try {
    const md = join(work, "notes.md");
    const bin = join(work, "image.png");
    await writeFile(md, "\uFEFF# Title\r\nline\r\n");
    await writeFile(bin, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]));

    const page = await app.firstWindow();
    await page.waitForSelector("#app");

    const r1 = await page.evaluate(
      async ({ md, bin, work }) => {
        const api = window.api;
        const before = await api.readFile(md).then(
          () => "readable",
          (e: Error) => e.message,
        );
        const add = await api.addFiles([md, bin]);
        const read = await api.readFile(md);
        const w1 = await api.writeFile({
          path: md,
          text: "# Title\nedited\n",
          eol: read.eol,
          bom: read.bom,
          expected: read.stamp,
        });
        const created = await api.createFile(work, "fresh");
        const state = await api.getState();
        return { before, add, read, w1, created, files: state.files.map((f) => f.path) };
      },
      { md, bin, work },
    );
    expect(r1.before).toContain("not in the file list");
    expect(r1.add.added).toEqual([md]);
    expect(r1.add.rejected).toEqual([{ path: bin, reason: "binary" }]);
    expect(r1.read).toMatchObject({ text: "# Title\nline\n", eol: "\r\n", bom: true, large: false });
    expect(r1.w1.ok).toBe(true);
    expect(await readFile(md, "utf8")).toBe("\uFEFF# Title\r\nedited\r\n");
    expect(r1.created).toEqual({ ok: true, path: join(work, "fresh.md") });
    expect(r1.files).toEqual([md, join(work, "fresh.md")]);

    // External change → guarded write conflicts; force wins.
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(md, "changed elsewhere");
    const r2 = await page.evaluate(
      async ({ md, stamp }) => {
        const api = window.api;
        const conflict = await api.writeFile({
          path: md,
          text: "mine",
          eol: "\n",
          bom: false,
          expected: stamp,
        });
        const forced = await api.writeFile({
          path: md,
          text: "mine",
          eol: "\n",
          bom: false,
          expected: stamp,
          force: true,
        });
        return { conflict, forced };
      },
      { md, stamp: r1.w1.ok ? r1.w1.stamp : null },
    );
    expect(r2.conflict.ok).toBe(false);
    expect(r2.forced.ok).toBe(true);
    expect(await readFile(md, "utf8")).toBe("mine");

    await close();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("the file list survives a relaunch", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-files-e2e-"));
  const userData = await mkdtemp(join(tmpdir(), "tiny-edit-files-ud-"));
  try {
    const md = join(work, "a.md");
    await writeFile(md, "a");
    const first = await launchApp(userData);
    const page = await first.app.firstWindow();
    await page.waitForSelector("#app");
    await page.evaluate((md) => window.api.addFiles([md]), md);
    await first.app.close();

    const second = await launchApp(userData);
    const page2 = await second.app.firstWindow();
    await page2.waitForSelector("#app");
    const files = await page2.evaluate(async () => (await window.api.getState()).files.map((f) => f.path));
    expect(files).toEqual([md]);
    await second.app.close();
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});
