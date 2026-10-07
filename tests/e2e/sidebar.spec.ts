import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("drag to reorder and drag the divider; both persist", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-sidebar-"));
  const userData = await mkdtemp(join(tmpdir(), "tiny-edit-sidebar-ud-"));
  try {
    const paths = ["one.md", "two.md", "three.md"].map((n) => join(work, n));
    for (const p of paths) await writeFile(p, p);
    const { app, close } = await launchApp(userData);
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    await page.evaluate((ps) => window.api.addFiles(ps), paths);
    const items = page.locator(".sidebar__item");
    await expect(items).toHaveText(["one", "two", "three"]);

    await items.nth(2).dragTo(items.nth(0), { targetPosition: { x: 10, y: 2 } });
    await expect(items).toHaveText(["three", "one", "two"]);

    const divider = page.locator(".sidebar__divider");
    const box = (await divider.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + 100, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(() => page.locator(".sidebar").evaluate((n) => n.getBoundingClientRect().width))
      .toBe(280);

    await page.waitForTimeout(400);
    await close();
    const saved = JSON.parse(await readFile(join(userData, "state.json"), "utf8"));
    expect(saved.files.map((f: { path: string }) => f.path)).toEqual([paths[2], paths[0], paths[1]]);
    expect(saved.sidebarWidth).toBe(280);
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});
