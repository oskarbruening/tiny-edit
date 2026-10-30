import { expect, test } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("fenced code blocks render as an inset panel distinct from prose lines", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-codeblock-"));
  const { app, close } = await launchApp();
  try {
    const md = join(work, "doc.md");
    await writeFile(md, ["intro prose", "", "```js", "const a = 1;", "```", ""].join("\n"));
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    await page.evaluate((p) => window.api.addFiles([p]), md);
    const content = page.locator(".cm-content");
    await expect(content).toContainText("const a");

    // Every line of the block (both fences + body) is decorated; prose is not.
    await expect(content.locator(".te-codeblock-line")).toHaveCount(3);
    const prose = content.locator(".cm-line", { hasText: "intro prose" });
    await expect(prose).not.toHaveClass(/te-codeblock-line/);

    // The panel paints a real background that prose lines do not have — on a pseudo-element
    // behind the line, never on the line itself, so the selection layer below stays visible.
    const bg = (loc: typeof prose, pseudo?: string) =>
      loc.evaluate((el, p) => getComputedStyle(el, p ?? null).backgroundColor, pseudo);
    const first = content.locator(".te-codeblock-first");
    const panelBg = await bg(first, "::before");
    const proseBg = await bg(prose);
    expect(panelBg).not.toBe(proseBg);
    expect(panelBg).not.toBe("rgba(0, 0, 0, 0)");
    expect(await bg(first)).toBe("rgba(0, 0, 0, 0)");

    // Selecting code inside the block shows the selection: the panel sits below CodeMirror's
    // selection layer in the scroller's stacking order, and the layer draws a rectangle for it.
    const panelZ = Number(await first.evaluate((el) => getComputedStyle(el, "::before").zIndex));
    const selectionZ = await page
      .locator(".cm-selectionLayer")
      .evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(panelZ).toBeLessThan(selectionZ);
    expect(selectionZ).toBeLessThan(0);
    await content.locator(".cm-line", { hasText: "const a" }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await expect(page.locator(".cm-selectionLayer .cm-selectionBackground")).toHaveCount(1);
    const selBox = await page.locator(".cm-selectionLayer .cm-selectionBackground").boundingBox();
    const lineBox = await content.locator(".cm-line", { hasText: "const a" }).boundingBox();
    expect(selBox!.width).toBeGreaterThan(0);
    expect(selBox!.y).toBeGreaterThanOrEqual(lineBox!.y - 1);
    expect(selBox!.y + selBox!.height).toBeLessThanOrEqual(lineBox!.y + lineBox!.height + 1);

    await close();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
