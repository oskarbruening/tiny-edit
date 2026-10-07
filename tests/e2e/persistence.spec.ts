import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers";

test("window size and position survive a relaunch", async () => {
  const userData = await mkdtemp(join(tmpdir(), "tiny-edit-persist-"));
  try {
    const first = await launchApp(userData);
    const page = await first.app.firstWindow();
    await page.waitForSelector("#app");
    // Read the bounds back synchronously right after setting them: that is what
    // the tracker must persist, whatever the OS does with the window later.
    const set = await first.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setContentSize(800, 600);
      win.setPosition(60, 80);
      return win.getNormalBounds();
    });
    expect(set).toMatchObject({ width: 800, x: 60, y: 80 });
    await page.waitForTimeout(400); // > 250 ms debounce
    await first.app.close();

    const saved = JSON.parse(await readFile(join(userData, "state.json"), "utf8"));
    expect(saved.version).toBe(1);
    expect(saved.window).toEqual(set);

    const second = await launchApp(userData);
    const page2 = await second.app.firstWindow();
    await page2.waitForSelector("#app");
    const restored = await second.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getNormalBounds(),
    );
    expect(restored).toEqual(set);
    const content = await second.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getContentSize(),
    );
    expect(content).toEqual([800, 600]);
    await second.app.close();
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("an off-screen saved position falls back to the default size, centred", async () => {
  const userData = await mkdtemp(join(tmpdir(), "tiny-edit-persist-"));
  try {
    await writeFile(
      join(userData, "state.json"),
      JSON.stringify({ version: 1, window: { x: 99999, y: 99999, width: 950, height: 500 } }),
    );
    const { app, close } = await launchApp(userData);
    const page = await app.firstWindow();
    await page.waitForSelector("#app");
    const info = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      const [x = 0, y = 0] = win.getPosition();
      const area = screen.getDisplayMatching(win.getBounds()).workArea;
      return {
        size: win.getContentSize(),
        inside: x >= area.x && y >= area.y && x < area.x + area.width && y < area.y + area.height,
      };
    });
    expect(info.size).toEqual([950, 500]);
    expect(info.inside).toBe(true);
    await close();
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("a corrupt state.json is moved aside and the app still launches", async () => {
  const userData = await mkdtemp(join(tmpdir(), "tiny-edit-persist-"));
  try {
    await writeFile(join(userData, "state.json"), "{ definitely not json");
    const { app, close } = await launchApp(userData);
    const page = await app.firstWindow();
    await page.waitForSelector("#app");
    const size = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getContentSize(),
    );
    expect(size).toEqual([950, 500]);
    const files = await readdir(userData);
    expect(files.some((f) => f.startsWith("state.json.corrupt-"))).toBe(true);
    await close();
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("renderer can read and patch state through window.api", async () => {
  const userData = await mkdtemp(join(tmpdir(), "tiny-edit-persist-"));
  try {
    const { app, close } = await launchApp(userData);
    const page = await app.firstWindow();
    await page.waitForSelector("#app");
    const result = await page.evaluate(async () => {
      const before = await window.api.getState();
      const after = await window.api.patchState({ fontSize: 18, sidebarWidth: 5 });
      const rejected = await window.api.patchState({ window: { width: 1 } } as never);
      return {
        before: before.fontSize,
        after: [after.fontSize, after.sidebarWidth],
        windowWidth: rejected.window.width,
      };
    });
    expect(result.before).toBe(14);
    expect(result.after).toEqual([18, 120]);
    expect(result.windowWidth).toBe(950);
    await close();
    const saved = JSON.parse(await readFile(join(userData, "state.json"), "utf8"));
    expect(saved.fontSize).toBe(18);
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});
