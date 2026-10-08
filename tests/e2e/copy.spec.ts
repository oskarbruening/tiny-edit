import { expect, test } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("hover copy buttons put inline code and code-block contents on the clipboard", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-copy-"));
  const { app, close } = await launchApp();
  try {
    const md = join(work, "doc.md");
    await writeFile(
      md,
      ["Run `npm test` now.", "", "```js", "const a = 1;", "const b = 2;", "```", ""].join("\n"),
    );
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    await page.evaluate((p) => window.api.addFiles([p]), md);
    const content = page.locator(".cm-content");
    await expect(content).toContainText("npm test");

    const clipboard = () => app.evaluate(({ clipboard: c }) => c.readText());

    // Inline: hover the line to reveal the button, then click it; the backticks are not copied.
    await app.evaluate(({ clipboard: c }) => c.writeText("SENTINEL"));
    await content.locator(".cm-line", { hasText: "npm test" }).hover();
    await content.locator(".te-copy-inline").click();
    await expect.poll(clipboard).toBe("npm test");

    // Block: hover a body line, then click the top-right button; fences and info string are excluded.
    await app.evaluate(({ clipboard: c }) => c.writeText("SENTINEL"));
    await content.locator(".cm-line", { hasText: "const a" }).hover();
    await content.locator(".te-copy-block").click();
    await expect.poll(clipboard).toBe("const a = 1;\nconst b = 2;");

    await close();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
