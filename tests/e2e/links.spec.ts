import { expect, test } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("the open-link button and Cmd+click open a Markdown link's destination in the browser", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-links-"));
  const { app, close } = await launchApp();
  try {
    // Capture shell.openExternal in the main process instead of launching a real browser.
    await app.evaluate(({ shell }) => {
      (globalThis as unknown as { __opened: string[] }).__opened = [];
      shell.openExternal = async (u: string) => {
        (globalThis as unknown as { __opened: string[] }).__opened.push(u);
        return undefined as unknown as void;
      };
    });
    const opened = () => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened);

    const md = join(work, "doc.md");
    await writeFile(md, ["See [the site](https://example.com) and [rel](./x.md).", ""].join("\n"));
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    await page.evaluate((p) => window.api.addFiles([p]), md);
    const content = page.locator(".cm-content");
    await expect(content).toContainText("the site");

    // Only the http(s) link gets a button; the relative link stays inert.
    const line = content.locator(".cm-line", { hasText: "the site" });
    await line.hover();
    await expect(content.locator(".te-open-link")).toHaveCount(1);
    await content.locator(".te-open-link").click();
    await expect.poll(opened).toEqual(["https://example.com"]);

    // Cmd+click anywhere on the link text opens it too.
    await content
      .locator(".te-link")
      .first()
      .click({ modifiers: ["Meta"] });
    await expect.poll(opened).toEqual(["https://example.com", "https://example.com"]);

    await close();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
