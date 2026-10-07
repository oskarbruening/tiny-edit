import { expect, test } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("markdown is coloured without hiding syntax; fenced code gets its grammar and rainbow brackets", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-hl-"));
  const { app, close } = await launchApp();
  try {
    const md = join(work, "doc.md");
    await writeFile(
      md,
      [
        "# Title",
        "",
        "Some **bold** text (with parens).",
        "",
        "```js",
        'const f = (a) => { return [a, "s"]; };',
        "```",
        "",
        "```nonsense",
        'x = "str" # note',
        "```",
        "",
      ].join("\n"),
    );
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    await page.evaluate((p) => window.api.addFiles([p]), md);
    const content = page.locator(".cm-content");
    await expect(content).toContainText("# Title");
    // Marker spans share the parent's class, so collect text across all matches.
    const joined = (sel: string) =>
      content.locator(sel).evaluateAll((ns) => ns.map((n) => n.textContent).join(""));
    await expect.poll(() => joined(".te-heading")).toBe("# Title");
    await expect.poll(() => joined(".te-strong")).toBe("**bold**");

    // Heading is colour only: same font size as body text.
    const sizes = await page.evaluate(() => {
      const h = document.querySelector(".te-heading")!;
      const line = h.closest(".cm-line")!;
      return [getComputedStyle(h).fontSize, getComputedStyle(line).fontSize, getComputedStyle(h).fontWeight];
    });
    expect(sizes[0]).toBe(sizes[1]);
    expect(["400", "normal"]).toContain(sizes[2]);

    // JS grammar loads lazily, then colours the keyword; the string in the unknown fence is coloured by the fallback.
    await expect(content.locator(".te-keyword").first()).toHaveText("const");
    await expect.poll(() => joined(".te-string")).toBe('"s""str"');
    await expect.poll(() => joined(".te-comment")).toBe("# note");

    // Rainbow brackets: inside code only, nested depth cycles; prose parens get no bracket class.
    const codeLine = content.locator(".cm-line", { hasText: "const f" });
    await expect(codeLine.locator(".te-bracket-1")).toHaveText(["(", ")", "{", "}"]);
    await expect(codeLine.locator(".te-bracket-2")).toHaveText(["[", "]"]);
    expect(await codeLine.locator(".te-bracket-3").count()).toBe(0);
    const proseLine = content.locator(".cm-line", { hasText: "with parens" });
    await expect(proseLine.locator("[class*='te-bracket']")).toHaveCount(0);

    await close();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
