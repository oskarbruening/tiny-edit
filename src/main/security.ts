import type { WebContents } from "electron";

/**
 * Hardening applied to every WebContents: no popups, no navigation away from the
 * page we loaded (reloads of the same URL stay allowed for dev HMR).
 */
export function hardenWebContents(
  contents: Pick<WebContents, "setWindowOpenHandler" | "on" | "getURL">,
): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (url !== contents.getURL()) event.preventDefault();
  });
}
