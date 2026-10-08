import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("settings: opens from the app menu, font-size slider and theme picks apply and persist, Esc closes", async () => {
  const userData = await mkdtemp(join(tmpdir(), "tiny-edit-settings-ud-"));
  try {
    const first = await launchApp(userData);
    const page = await first.app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    const cssVar = (name: string) =>
      page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
    const clickMenu = (id: string) =>
      first.app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.click(), id);

    const panel = page.locator(".settings__panel");
    await expect(panel).toBeHidden();
    await clickMenu("settings");
    await expect(panel).toBeVisible();
    await expect(page.locator(".settings__title")).toHaveText("Settings");

    // Slider: 1 px steps from the current 14 px; two steps right → 16 px.
    const slider = page.locator(".settings__font");
    await expect(slider).toHaveValue("14");
    await expect(page.locator(".settings__font-value")).toHaveText("14 px");
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveValue("15");
    await expect(page.locator(".settings__font-value")).toHaveText("15 px");
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveValue("16");
    await expect(page.locator(".settings__font-value")).toHaveText("16 px");
    await expect.poll(() => cssVar("--te-font-size")).toBe("16px");

    // Theme: Fixed + Tokyo Night paints immediately and ticks the View → Theme radio.
    await page.locator("#settings-mode-fixed").check();
    await page.locator(".settings__fixed").selectOption("tokyo-night");
    await expect.poll(() => cssVar("--te-surface")).toBe("#1a1b26");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset["theme"]))
      .toBe("tokyo-night");
    await expect
      .poll(() =>
        first.app.evaluate(
          ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("theme-tokyo-night")!.checked,
        ),
      )
      .toBe(true);

    // Menu changes are mirrored into the open panel.
    await clickMenu("theme-auto");
    await expect(page.locator("#settings-mode-auto")).toBeChecked();
    await expect(page.locator(".settings__fixed")).toBeDisabled();

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await clickMenu("settings");
    await expect(panel).toBeVisible();
    await page.locator(".settings__done").click();
    await expect(panel).toBeHidden();
    await first.close();

    // Relaunch: the chosen size survives and the slider shows it.
    const second = await launchApp(userData);
    const page2 = await second.app.firstWindow();
    await page2.waitForSelector(".sidebar__empty");
    await expect
      .poll(() =>
        page2.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--te-font-size").trim(),
        ),
      )
      .toBe("16px");
    await second.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("settings")!.click());
    await expect(page2.locator(".settings__font")).toHaveValue("16");
    await second.close();
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});
