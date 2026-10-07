import { expect, test } from "@playwright/test";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("a clean file edited by another program reloads in place; deleting it dims the entry", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-watch-"));
  const { app, close } = await launchApp();
  try {
    const a = join(work, "alpha.md");
    const b = join(work, "beta.md");
    await writeFile(a, "alpha v1\n");
    await writeFile(b, "beta v1\n");
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    await page.evaluate((paths) => window.api.addFiles(paths), [a, b]);
    await expect(page.locator(".cm-content")).toContainText("alpha v1");

    // Active + clean → silent reload.
    await writeFile(a, "alpha v2 from elsewhere\n");
    await expect(page.locator(".cm-content")).toContainText("alpha v2 from elsewhere");
    await expect(page.locator(".notice")).toBeHidden();

    // Background + clean → reloaded before we switch (open beta first so it is loaded).
    await page.locator(".sidebar__item", { hasText: "beta" }).click();
    await expect(page.locator(".cm-content")).toContainText("beta v1");
    await page.locator(".sidebar__item", { hasText: "alpha" }).click();
    await writeFile(b, "beta v2\n");
    await page.waitForTimeout(600);
    await page.locator(".sidebar__item", { hasText: "beta" }).click();
    await expect(page.locator(".cm-content")).toContainText("beta v2");

    // Deleted underneath → dimmed + notice; typing recreates it.
    await unlink(b);
    await expect(page.locator(".notice")).toContainText("File not found");
    await expect(page.locator(".sidebar__item", { hasText: "beta" })).toHaveClass(/is-missing/);
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("!");
    await expect(page.locator(".notice")).toBeHidden();
    await expect(page.locator(".sidebar__item", { hasText: "beta" })).not.toHaveClass(/is-missing/);
    await close();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
