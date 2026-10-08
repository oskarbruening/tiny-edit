import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("File → Recently Closed lists removed files, reopens them, stays unique, and disambiguates names", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-recent-"));
  const { app, close } = await launchApp();
  try {
    // Two files with the SAME name in different folders, plus one unique name.
    const aDir = join(work, "a");
    const bDir = join(work, "b");
    await mkdir(aDir);
    await mkdir(bDir);
    const todoA = join(aDir, "todo.md");
    const todoB = join(bDir, "todo.md");
    const notes = join(work, "notes.md");
    await writeFile(todoA, "A\n");
    await writeFile(todoB, "B\n");
    await writeFile(notes, "N\n");

    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    await page.evaluate((paths) => window.api.addFiles(paths), [todoA, todoB, notes]);
    await expect(page.locator(".sidebar__item")).toHaveText(["todo", "todo", "notes"]);

    const recentLabels = () =>
      app.evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()!.getMenuItemById("recently-closed")!;
        return (item.submenu?.items ?? []).map((i) => i.label);
      });
    const recentEnabled = () =>
      app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("recently-closed")!.enabled);
    const clickRecent = (label: string) =>
      app.evaluate(({ Menu }, label) => {
        const item = Menu.getApplicationMenu()!.getMenuItemById("recently-closed")!;
        item.submenu!.items.find((i) => i.label === label)!.click();
      }, label);

    // Nothing closed yet → the submenu is disabled.
    expect(await recentEnabled()).toBe(false);

    // Close todo(a), then todo(b), then notes (⌘W removes the active file). Newest is first.
    const closeActive = () =>
      app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("close-file")!.click());
    await page.locator(".sidebar__item").first().click(); // todo (a)
    await closeActive();
    await page.locator(".sidebar__item", { hasText: "todo" }).first().click(); // todo (b)
    await closeActive();
    await page.locator(".sidebar__item", { hasText: "notes" }).click();
    await closeActive();

    // Both todos share a name → each shows its folder; notes is unique → bare name. Newest first.
    await expect.poll(recentLabels).toEqual(["notes.md", `todo.md — ${bDir}`, `todo.md — ${aDir}`]);

    // Reopening one todo removes exactly that entry. The remaining todo is now the only "todo.md"
    // on the list, so it drops its folder suffix.
    await clickRecent(`todo.md — ${bDir}`);
    await expect(page.locator(".sidebar__item")).toHaveText(["todo"]);
    await expect.poll(recentLabels).toEqual(["notes.md", "todo.md"]);

    // Reopening notes leaves just the other todo on the list.
    await clickRecent("notes.md");
    await expect(page.locator(".sidebar__item")).toHaveText(["todo", "notes"]);
    await expect.poll(recentLabels).toEqual(["todo.md"]);
  } finally {
    await close();
    await rm(work, { recursive: true, force: true });
  }
});
