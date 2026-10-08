import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("structured files get their own highlighting; Pretty Format rewrites JSON/YAML and is undoable; TOML highlights only", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-format-"));
  const { app, close } = await launchApp();
  try {
    const data = join(work, "data.json");
    const conf = join(work, "conf.yaml");
    const cargo = join(work, "cargo.toml");
    const note = join(work, "note.txt");
    await writeFile(data, '{"b":2,"a":[1,2,  3]}');
    await writeFile(conf, "a:   1\nb:\n  - x\n  -   y\n");
    await writeFile(cargo, 'name = "tiny" # a comment\n');
    await writeFile(note, "plain text\n");

    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    await page.evaluate((paths) => window.api.addFiles(paths), [data, conf, cargo, note]);
    await expect(page.locator(".sidebar__item")).toHaveText([
      "data.json",
      "conf.yaml",
      "cargo.toml",
      "note.txt",
    ]);
    await expect(page.locator(".cm-content")).toContainText('"b"');

    // The JSON file is highlighted as JSON (a property class), not as Markdown.
    await expect(page.locator(".cm-content .te-property").first()).toContainText('"b"');

    const clickMenu = (id: string) =>
      app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.click(), id);
    const menuEnabled = (id: string) =>
      app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.enabled, id);

    // Enabled for the active JSON file.
    expect(await menuEnabled("pretty-format")).toBe(true);
    await clickMenu("pretty-format");

    // The buffer is reformatted (two-space indent) …
    await expect(page.locator(".cm-content")).toContainText('"a": [1, 2, 3]');
    // … and autosave writes the formatted text to disk, keeping key order.
    await expect.poll(async () => readFile(data, "utf8")).toBe('{ "b": 2, "a": [1, 2, 3] }\n');

    // Undo reverts the whole format in one step.
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+z");
    await expect(page.locator(".cm-content")).toContainText('{"b":2,"a":[1,2,  3]}');

    // YAML also pretty-formats (built-in Prettier parser, no extra dependency).
    await page.locator(".sidebar__item", { hasText: "conf.yaml" }).click();
    await expect(page.locator(".cm-content")).toContainText("a:   1");
    await expect.poll(() => menuEnabled("pretty-format")).toBe(true);
    await clickMenu("pretty-format");
    await expect.poll(async () => readFile(conf, "utf8")).toBe("a: 1\nb:\n  - x\n  - y\n");

    // TOML is highlighted (its own string/comment colours) but Pretty Format stays disabled.
    await page.locator(".sidebar__item", { hasText: "cargo.toml" }).click();
    await expect(page.locator(".cm-content")).toContainText('"tiny"');
    await expect(page.locator(".cm-content .te-comment").first()).toContainText("# a comment");
    await expect.poll(() => menuEnabled("pretty-format")).toBe(false);

    // Pretty Format is disabled for a plain-text file.
    await page.locator(".sidebar__item", { hasText: "note.txt" }).click();
    await expect(page.locator(".cm-content")).toContainText("plain text");
    await expect.poll(() => menuEnabled("pretty-format")).toBe(false);
  } finally {
    await close();
    await rm(work, { recursive: true, force: true });
  }
});
