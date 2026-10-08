import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("pages: welcome page with no file, Help → What's New, file reopens untouched", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-pages-"));
  const { app, close } = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    const content = page.locator(".cm-content");
    const clickMenu = (id: string) =>
      app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.click(), id);

    // Fresh install: the welcome page, highlighted and read-only.
    await expect(content).toContainText("Welcome to Tiny Edit");
    await expect(content).toContainText("Your words are always saved");
    await expect(page.locator(".te-heading").first()).toBeVisible();
    await expect(content).toHaveAttribute("aria-readonly", "true");

    const a = join(work, "alpha.md");
    await writeFile(a, "alpha\n");
    await page.evaluate((p) => window.api.addFiles([p]), a);
    await expect(content).toContainText("alpha");
    await expect(content).not.toContainText("Welcome to Tiny Edit");

    await clickMenu("whats-new");
    await expect(content).toContainText("What's New in Tiny Edit");
    await expect(page.locator(".sidebar__item.is-active")).toHaveCount(0);
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle()))
      .toBe("Tiny Edit");

    await page.locator(".sidebar__item").first().click();
    await expect(content).toContainText("alpha");
    expect(await readFile(a, "utf8")).toBe("alpha\n");

    // Closing the last file brings the welcome page back.
    await clickMenu("close-file");
    await expect(content).toContainText("Welcome to Tiny Edit");
  } finally {
    await close();
    await rm(work, { recursive: true, force: true });
  }
});
