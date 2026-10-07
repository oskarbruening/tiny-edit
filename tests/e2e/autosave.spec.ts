import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

async function openWith(text: string) {
  const work = await mkdtemp(join(tmpdir(), "tiny-edit-autosave-"));
  const file = join(work, "doc.md");
  await writeFile(file, text);
  const launched = await launchApp();
  const page = await launched.app.firstWindow();
  await page.waitForSelector(".sidebar__empty");
  await page.evaluate((p) => window.api.addFiles([p]), file);
  await expect(page.locator(".cm-content")).toContainText(text.trim().split(/\r?\n/)[0]!);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  return { ...launched, page, file, work };
}

test("typing is saved to disk after the idle period, byte-faithfully (CRLF + BOM kept)", async () => {
  const { page, file, work, close } = await openWith("﻿line one\r\nline two\r\n");
  try {
    await page.keyboard.type("three");
    await expect.poll(() => readFile(file, "utf8"), { timeout: 3000 }).toBe("﻿line one\r\nline two\r\nthree");
    await close();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("closing the window right after typing still writes the last keystrokes", async () => {
  const { page, file, work, app } = await openWith("start\n");
  try {
    await page.keyboard.type("end");
    await app.close(); // close event → renderer:flush → renderer:flushed → destroy
    expect(await readFile(file, "utf8")).toBe("start\nend");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("an external change while there are unsaved edits shows Reload / Keep mine", async () => {
  const { page, file, work, close } = await openWith("original\n");
  try {
    // Type and immediately replace the file underneath, inside the 300 ms idle window.
    await page.keyboard.insertText("mine");
    await writeFile(file, "theirs\n");
    const notice = page.locator(".notice");
    await expect(notice).toContainText("Changed on disk");
    await expect(notice.locator("button")).toHaveText(["Reload", "Keep mine"]);
    expect(await readFile(file, "utf8")).toBe("theirs\n"); // nothing overwritten yet

    await notice.getByRole("button", { name: "Keep mine" }).click();
    await expect.poll(() => readFile(file, "utf8")).toBe("original\nmine");
    await expect(notice).toBeHidden();

    await page.keyboard.insertText("+");
    await writeFile(file, "theirs again\n");
    await expect(notice).toContainText("Changed on disk");
    await notice.getByRole("button", { name: "Reload" }).click();
    await expect(page.locator(".cm-content")).toContainText("theirs again");
    await expect(notice).toBeHidden();
    await page.waitForTimeout(500);
    expect(await readFile(file, "utf8")).toBe("theirs again\n");
    await close();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
