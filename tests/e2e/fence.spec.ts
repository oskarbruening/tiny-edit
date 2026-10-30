import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("typing ``` adds the closing fence; closing an open block by hand adds nothing", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-fence-"));
  const { app, close } = await launchApp();
  try {
    const md = join(work, "notes.md");
    const open = join(work, "open.md");
    await writeFile(md, "intro\n\n");
    await writeFile(open, "```py\nprint(1)\n");
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    await page.evaluate((paths) => window.api.addFiles(paths), [md, open]);
    const content = page.locator(".cm-content");
    const lines = content.locator(".cm-line");
    await expect(content).toContainText("intro");

    await content.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("```");
    await expect(lines).toHaveText(["intro", "", "```", "```"]);

    // The caret stays after the opening fence: the info string goes there, Enter lands inside.
    await page.keyboard.type("ts");
    await page.keyboard.press("Enter");
    await page.keyboard.type("const a = 1;");
    await expect(lines).toHaveText(["intro", "", "```ts", "const a = 1;", "```"]);

    // Right below a closed block the same three keystrokes open (and close) a new one.
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("```");
    await page.keyboard.press("Enter");
    await page.keyboard.type("x");
    await expect(lines).toHaveText(["intro", "", "```ts", "const a = 1;", "```", "```", "x", "```"]);

    // Autosave writes exactly what is on screen.
    await expect
      .poll(() => readFile(md, "utf8"), { timeout: 3000 })
      .toBe("intro\n\n```ts\nconst a = 1;\n```\n```\nx\n```");

    // A block that is still open: typing ``` closes it by hand, nothing is added.
    await page.locator(".sidebar__item", { hasText: "open" }).click();
    await expect(content).toContainText("print(1)");
    await content.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("```");
    await expect(lines).toHaveText(["```py", "print(1)", "```"]);
    await expect.poll(() => readFile(open, "utf8"), { timeout: 3000 }).toBe("```py\nprint(1)\n```");

    await close();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
