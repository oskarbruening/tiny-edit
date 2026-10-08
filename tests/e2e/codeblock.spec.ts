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

    // The panel paints a real background that prose lines do not have.
    const bg = (loc: typeof prose) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
    const blockBg = await bg(content.locator(".te-codeblock-first"));
    const proseBg = await bg(prose);
    expect(blockBg).not.toBe(proseBg);
    expect(blockBg).not.toBe("rgba(0, 0, 0, 0)");

    await close();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
