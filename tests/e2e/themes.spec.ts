import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("themes: menu switch, automatic follows macOS, user theme hot-reload, persistence", async () => {
  const userData = await mkdtemp(join(tmpdir(), "tiny-edit-themes-ud-"));
  try {
    const first = await launchApp(userData);
    const page = await first.app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    const cssVar = (name: string) =>
      page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
    const clickMenu = (id: string) =>
      first.app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.click(), id);
    const bg = () =>
      first.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.getBackgroundColor().toLowerCase(),
      );

    // Automatic: force the OS appearance through nativeTheme.
    await first.app.evaluate(({ nativeTheme }) => (nativeTheme.themeSource = "light"));
    await expect.poll(() => cssVar("--te-surface")).toBe("#ffffff"); // macOS Light
    await first.app.evaluate(({ nativeTheme }) => (nativeTheme.themeSource = "dark"));
    await expect.poll(() => cssVar("--te-surface")).toBe("#1e1e1e"); // macOS Dark
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset["appearance"])).toBe("dark");
    await expect.poll(bg).toBe("#1e1e1e");

    // Fixed theme from the menu.
    await clickMenu("theme-tokyo-night");
    await expect.poll(() => cssVar("--te-surface")).toBe("#1a1b26");
    await expect.poll(() => cssVar("--te-syntax-keyword")).toBe("#bb9af7");
    await expect.poll(bg).toBe("#1a1b26");
    const checked = await first.app.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("theme-tokyo-night")!.checked,
    );
    expect(checked).toBe(true);

    // User theme dropped into the folder appears in the menu and can be chosen.
    await writeFile(
      join(userData, "themes", "ember.json"),
      JSON.stringify({ name: "Ember", colors: { surface: "#2a1c17", ink: "#f3e9dc" } }),
    );
    await expect
      .poll(
        () =>
          first.app.evaluate(
            ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("theme-ember")?.label ?? null,
          ),
        { timeout: 5000 },
      )
      .toBe("Ember (custom)");
    await clickMenu("theme-ember");
    await expect.poll(() => cssVar("--te-surface")).toBe("#2a1c17");
    await expect.poll(() => cssVar("--te-ink")).toBe("#f3e9dc");

    await page.waitForTimeout(400);
    await first.app.close();
    const saved = JSON.parse(await readFile(join(userData, "state.json"), "utf8"));
    expect(saved.theme).toMatchObject({ mode: "fixed", fixed: "ember" });

    const second = await launchApp(userData);
    const page2 = await second.app.firstWindow();
    await page2.waitForSelector(".sidebar__empty");
    await expect
      .poll(() =>
        page2.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--te-surface").trim(),
        ),
      )
      .toBe("#2a1c17");
    await second.app.close();
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});
