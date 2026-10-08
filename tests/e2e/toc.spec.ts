import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

const DOC = ["# Alpha", "alpha body", "## A1", "a1 body", "# Beta", "beta body"].join("\n");

test("outline chevron scopes the editor to a section and editing writes the whole file", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-toc-"));
  const userData = await mkdtemp(join(tmpdir(), "tiny-edit-toc-ud-"));
  try {
    const file = join(work, "doc.md");
    await writeFile(file, DOC);
    const { app, close } = await launchApp(userData);
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    await page.evaluate((p) => window.api.addFiles([p]), file);

    // A file with two H1s earns a chevron; expanding it lists H1 and H2 flattened.
    const chevron = page.locator(".sidebar__chevron");
    await expect(chevron).toBeVisible();
    await chevron.click();
    await expect(page.locator(".sidebar__toc-item")).toHaveText(["Alpha", "A1", "Beta"]);

    // Click the "Beta" section → the editor shows only it; "alpha body" is hidden.
    await page.locator(".sidebar__toc-item", { hasText: "Beta" }).click();
    const content = page.locator(".cm-content");
    await expect(content).toContainText("Beta");
    await expect(content).toContainText("beta body");
    await expect(content).not.toContainText("alpha body");
    await expect(page.locator(".sidebar__toc-item.is-current")).toHaveText("Beta");

    // Edit inside the section, then let autosave flush: the rest of the file is intact on disk.
    await page.locator(".cm-line", { hasText: "beta body" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" EDITED");
    await page.waitForTimeout(400);
    const saved = await readFile(file, "utf8");
    expect(saved).toContain("beta body EDITED");
    expect(saved).toContain("# Alpha");
    expect(saved).toContain("alpha body");
    expect(saved.startsWith("# Alpha\n")).toBe(true);

    // Clicking the filename returns to the whole document.
    await page.locator(".sidebar__name").click();
    await expect(content).toContainText("alpha body");

    await close();
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});
