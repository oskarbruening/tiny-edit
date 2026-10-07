import { expect, test } from "@playwright/test";
import { API_KEYS } from "../../src/shared/ipc";
import { launchApp } from "./helpers";

test("first launch opens a 950×500 window and shows the shell", async () => {
  const { app, close } = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".editor__host");

    const size = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getContentSize(),
    );
    expect(size).toEqual([950, 500]);

    const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible());
    expect(visible).toBe(true);

    expect(await page.title()).toBe("Tiny Edit");
    expect(page.url()).toBe("app://renderer/index.html"); // served by our own scheme, not file://
    const sidebarWidth = await page.locator(".sidebar").evaluate((n) => n.getBoundingClientRect().width);
    expect(sidebarWidth).toBe(200);
  } finally {
    await close();
  }
});

test("renderer is sandboxed: no Node, only the window.api contract", async () => {
  const { app, close } = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForSelector("#app");
    const probe = await page.evaluate(() => ({
      hasRequire: typeof (window as unknown as { require?: unknown }).require,
      hasProcess: typeof (window as unknown as { process?: unknown }).process,
      apiKeys: Object.keys(window.api),
      electron: window.api.versions.electron,
    }));
    expect(probe.hasRequire).toBe("undefined");
    expect(probe.hasProcess).toBe("undefined");
    expect([...probe.apiKeys].sort()).toEqual([...API_KEYS].sort());
    expect(probe.electron).toMatch(/^44\./);
  } finally {
    await close();
  }
});

test("window.open and navigation away are denied", async () => {
  const { app, close } = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForSelector("#app");
    const before = page.url();
    await page.evaluate(() => {
      window.open("https://example.com");
      const a = document.createElement("a");
      a.href = "https://example.com/";
      document.body.append(a);
      a.click();
    });
    await page.waitForTimeout(500);
    expect(page.url()).toBe(before);
    const count = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    expect(count).toBe(1);
  } finally {
    await close();
  }
});
