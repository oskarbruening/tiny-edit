// Prints connected displays and the main window's bounds over time, to see whether
// anything outside the app moves or resizes freshly created windows.
// Run from a normal terminal after `npm run build`:  node scripts/diag-window.mjs
import { _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const userData = await mkdtemp(join(tmpdir(), "tiny-edit-diag-"));
const app = await electron.launch({ args: ["."], env: { ...process.env, TINY_EDIT_USER_DATA: userData } });
const page = await app.firstWindow();
await page.waitForSelector("#app");

const displays = await app.evaluate(({ screen }) =>
  screen.getAllDisplays().map((d) => ({
    id: d.id,
    bounds: d.bounds,
    workArea: d.workArea,
    scale: d.scaleFactor,
    primary: d.id === screen.getPrimaryDisplay().id,
  })),
);
console.log("displays:", JSON.stringify(displays, null, 2));

const snap = (label) =>
  app
    .evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return {
        bounds: w.getBounds(),
        content: w.getContentSize(),
        normal: w.getNormalBounds(),
        max: w.isMaximized(),
        full: w.isFullScreen(),
      };
    })
    .then((r) => console.log(label, JSON.stringify(r)));

await snap("t=0ms      ");
await page.waitForTimeout(300);
await snap("t=300ms    ");
await page.waitForTimeout(700);
await snap("t=1000ms   ");
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setContentSize(800, 600);
  w.setPosition(60, 80);
});
await snap("after set  ");
await page.waitForTimeout(500);
await snap("set+500ms  ");
await page.waitForTimeout(1500);
await snap("set+2000ms ");
await app.close();
await rm(userData, { recursive: true, force: true });
