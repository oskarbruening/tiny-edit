import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("sidebar lists dropped files, clicking switches, edits and caret survive switching and relaunch", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-editor-"));
  const userData = await mkdtemp(join(tmpdir(), "tiny-edit-editor-ud-"));
  try {
    const a = join(work, "alpha.md");
    const b = join(work, "beta.txt");
    await writeFile(a, "# Alpha\n\nfirst file\n");
    await writeFile(b, "beta body\n");

    const first = await launchApp(userData);
    const page = await first.app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    await page.evaluate((paths) => window.api.addFiles(paths), [a, b]);

    const items = page.locator(".sidebar__item");
    await expect(items).toHaveText(["alpha", "beta"]);
    await expect(items.nth(0)).toHaveClass(/is-active/);
    await expect(page.locator(".cm-content")).toContainText("first file");

    // Markdown is coloured, not hidden: the '#' marker is still in the DOM text.
    expect(await page.locator(".cm-line").first().textContent()).toBe("# Alpha");

    // Type at the end of alpha; no autocorrect: straight quotes and brackets stay literal.
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type('"quoted" (x) i ');
    await expect(page.locator(".cm-content")).toContainText('"quoted" (x) i');

    await items.nth(1).click();
    await expect(items.nth(1)).toHaveClass(/is-active/);
    await expect(page.locator(".cm-content")).toContainText("beta body");
    await items.nth(0).click();
    await expect(page.locator(".cm-content")).toContainText('"quoted" (x) i');

    // Caret position is persisted per file (debounced), so wait for state.json.
    await page.waitForTimeout(700);
    await first.app.close();
    const saved = JSON.parse(await readFile(join(userData, "state.json"), "utf8"));
    expect(saved.activePath).toBe(a);
    const alpha = saved.files.find((f: { path: string }) => f.path === a);
    expect(alpha.anchor).toBeGreaterThan(10);

    // Relaunch: alpha reopens from disk (edits were in memory only in this step).
    const second = await launchApp(userData);
    const page2 = await second.app.firstWindow();
    await expect(page2.locator(".sidebar__item.is-active")).toHaveText("alpha");
    await expect(page2.locator(".cm-content")).toContainText("first file");
    await second.app.close();
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});

test("a missing active file shows the recreate notice and a dimmed entry", async () => {
  const userData = await mkdtemp(join(tmpdir(), "tiny-edit-editor-ud-"));
  try {
    const ghost = join(userData, "gone.md");
    await writeFile(
      join(userData, "state.json"),
      JSON.stringify({
        version: 1,
        files: [{ path: ghost, anchor: 0, head: 0, scrollTop: 0 }],
        activePath: ghost,
      }),
    );
    const { app, close } = await launchApp(userData);
    const page = await app.firstWindow();
    await expect(page.locator(".notice")).toContainText("File not found");
    await expect(page.locator(".sidebar__item")).toHaveClass(/is-missing/);
    await close();
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});
