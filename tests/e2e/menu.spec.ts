import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("menu: New File inline input, Close File, Toggle Sidebar, Zoom, window title", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-menu-"));
  const { app, close, userData } = await launchApp();
  try {
    const a = join(work, "alpha.md");
    await writeFile(a, "alpha\n");
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    await page.evaluate((p) => window.api.addFiles([p]), a);
    await expect(page.locator(".sidebar__item")).toHaveText(["alpha"]);
    await expect(page.locator(".cm-content")).toContainText("alpha"); // file fully opened before using the menu
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle()))
      .toBe("alpha");
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getRepresentedFilename()),
    ).toBe(a);

    const clickMenu = (id: string) =>
      app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.click(), id);

    await clickMenu("new-file");
    const input = page.locator(".sidebar__new-input");
    await expect(input).toBeFocused();
    // keyboard.type, not fill(): fill uses CDP Input.insertText, which can hang in Electron
    // when the window is not frontmost (see CLAUDE.md → Testing).
    await page.keyboard.type("alpha");
    await page.keyboard.press("Enter");
    await expect(page.locator(".sidebar__new-error")).toHaveText("alpha.md already exists");
    // Meta+A would be swallowed by the Edit menu's Select All role; clear the field with Backspace.
    // Focus must still be on the field after an error; report the thief if not.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const a = document.activeElement;
          return a ? `${a.tagName.toLowerCase()}.${a.className}` : "none";
        }),
      )
      .toBe("input.sidebar__new-input");
    for (let i = 0; i < "alpha".length; i++) await page.keyboard.press("Backspace");
    await page.keyboard.type("beta");
    await expect(input).toHaveValue("beta");
    await page.keyboard.press("Enter");
    await expect(page.locator(".sidebar__item")).toHaveText(["alpha", "beta"]);
    await expect(page.locator(".sidebar__item.is-active")).toHaveText("beta");
    expect(await readFile(join(work, "beta.md"), "utf8")).toBe("");

    await clickMenu("close-file");
    await expect(page.locator(".sidebar__item")).toHaveText(["alpha"]);
    await expect(page.locator(".sidebar__item.is-active")).toHaveText("alpha");
    expect(await readFile(join(work, "beta.md"), "utf8")).toBe(""); // still on disk

    await clickMenu("toggle-sidebar");
    await expect(page.locator(".sidebar")).toBeHidden();
    await clickMenu("toggle-sidebar");
    await expect(page.locator(".sidebar")).toBeVisible();

    await clickMenu("zoom-in");
    await clickMenu("zoom-in");
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--te-font-size").trim(),
        ),
      )
      .toBe("16px");
    await clickMenu("zoom-reset");
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--te-font-size").trim(),
        ),
      )
      .toBe("14px");

    await clickMenu("find");
    await expect(page.locator(".cm-search")).toBeVisible();

    await close();
    void userData;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("Open… (dialog stubbed) and Finder/Dock open-file both add files", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-menu-"));
  const { app, close } = await launchApp();
  try {
    const picked = join(work, "picked.md");
    const dock = join(work, "dock.txt");
    await writeFile(picked, "picked\n");
    await writeFile(dock, "dock\n");
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar__empty");

    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [p],
      })) as typeof dialog.showOpenDialog;
    }, picked);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("open-file")!.click());
    await expect(page.locator(".sidebar__item")).toHaveText(["picked"]);
    await expect(page.locator(".cm-content")).toContainText("picked");

    await app.evaluate(({ app }, p) => app.emit("open-file", { preventDefault: () => undefined }, p), dock);
    await expect(page.locator(".sidebar__item")).toHaveText(["picked", "dock"]);
    await expect(page.locator(".sidebar__item.is-active")).toHaveText("dock");
    await close();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
