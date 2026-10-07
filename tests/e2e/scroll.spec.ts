import { expect, test } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("a long document scrolls inside the editor and the caret stays in view at the end", async () => {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-scroll-"));
  const { app, close } = await launchApp();
  try {
    const md = join(work, "long.md");
    await writeFile(md, Array.from({ length: 400 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
    const page = await app.firstWindow();
    await page.waitForSelector(".sidebar__empty");
    await page.evaluate((p) => window.api.addFiles([p]), md);
    await expect(page.locator(".cm-content")).toContainText("line 1");

    const metrics = () =>
      page.evaluate(() => {
        const s = document.querySelector<HTMLElement>(".cm-scroller")!;
        const host = document.querySelector<HTMLElement>(".editor__host")!;
        return {
          scrollTop: s.scrollTop,
          scrollable: s.scrollHeight > s.clientHeight,
          hostHeight: host.getBoundingClientRect().height,
          scrollerHeight: s.getBoundingClientRect().height,
        };
      });
    const before = await metrics();
    expect(before.scrollable).toBe(true);
    expect(before.scrollerHeight).toBeLessThanOrEqual(before.hostHeight + 1); // the scroller is bounded by the host

    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+End");
    await expect.poll(async () => (await metrics()).scrollTop).toBeGreaterThan(0);
    const caret = await page.evaluate(() => {
      const c =
        document.querySelector<HTMLElement>(".cm-cursor") ??
        document.querySelector<HTMLElement>(".cm-cursor-primary");
      const host = document.querySelector<HTMLElement>(".editor__host")!.getBoundingClientRect();
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return r.top >= host.top && r.bottom <= host.bottom;
    });
    expect(caret).toBe(true);
    await close();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
