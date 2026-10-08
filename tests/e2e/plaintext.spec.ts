import { expect, test } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("settings: syntax highlighting off makes all text one colour, keeps code-block panels and copy buttons, persists", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-plain-"));
  const userData = await mkdtemp(join(tmpdir(), "tiny-edit-plain-ud-"));
  try {
    const md = join(work, "doc.md");
    await writeFile(
      md,
      ["# Title", "", "Some **bold** text and `code`.", "", "```js", 'const s = "str";', "```", ""].join(
        "\n",
      ),
    );
    const first = await launchApp(userData);
    const page = await first.app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    await page.evaluate((p) => window.api.addFiles([p]), md);
    const content = page.locator(".cm-content");
    await expect(content.locator(".te-keyword").first()).toHaveText("const");

    const style = (sel: string, prop: string) =>
      page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s)!).getPropertyValue(p), [
        sel,
        prop,
      ] as const);
    const inkColor = () => style(".cm-content", "color");

    // Highlighted: the heading and the keyword differ from body text; strong is bold.
    expect(await style(".te-heading", "color")).not.toBe(await inkColor());
    expect(await style(".te-keyword", "color")).not.toBe(await inkColor());
    expect(await style(".te-strong", "font-weight")).toBe("700");

    // Untick Syntax highlighting in Settings.
    await first.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("settings")!.click());
    const box = page.locator("#settings-highlight");
    await expect(box).toBeChecked();
    await box.uncheck();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains("highlight-off")))
      .toBe(true);
    await page.keyboard.press("Escape");

    // Plain: every token renders in the body colour, no bold; the markers themselves stay visible.
    for (const sel of [".te-heading", ".te-strong", ".te-inline-code", ".te-keyword", ".te-string"])
      expect(await style(sel, "color"), sel).toBe(await inkColor());
    expect(await style(".te-strong", "font-weight")).toBe("400");
    await expect(content).toContainText("# Title");
    await expect(content).toContainText("**bold**");

    // The code-block panel keeps its background and border, and hover still reveals the copy buttons.
    const prose = content.locator(".cm-line", { hasText: "Some" });
    const panel = content.locator(".te-codeblock-first");
    const bg = (loc: typeof prose) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg(panel)).not.toBe(await bg(prose));
    expect(await panel.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid");
    await first.app.evaluate(({ clipboard: c }) => c.writeText("SENTINEL"));
    await content.locator(".cm-line", { hasText: "const s" }).hover();
    await content.locator(".te-copy-block").click();
    await expect.poll(() => first.app.evaluate(({ clipboard: c }) => c.readText())).toBe('const s = "str";');
    await content.locator(".cm-line", { hasText: "Some" }).hover();
    await expect(content.locator(".te-copy-inline")).toBeVisible();
    await first.close();

    // Relaunch: the switch stays off.
    const second = await launchApp(userData);
    const page2 = await second.app.firstWindow();
    await page2.waitForSelector(".cm-content");
    await expect
      .poll(() => page2.evaluate(() => document.documentElement.classList.contains("highlight-off")))
      .toBe(true);
    await second.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("settings")!.click());
    await expect(page2.locator("#settings-highlight")).not.toBeChecked();
    await second.close();
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});
