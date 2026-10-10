import { _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Launched = { app: ElectronApplication; userData: string; close: () => Promise<void> };

/** Launches the built app with an isolated userData directory. Extra args follow "." (the app). */
export async function launchApp(userData?: string, extraArgs: string[] = []): Promise<Launched> {
  const dir = userData ?? (await mkdtemp(join(tmpdir(), "tiny-edit-e2e-")));
  const app = await electron.launch({
    args: [".", ...extraArgs],
    env: { ...process.env, TINY_EDIT_USER_DATA: dir, NODE_ENV: "production" },
  });
  return {
    app,
    userData: dir,
    close: async () => {
      await app.close();
      if (!userData) await rm(dir, { recursive: true, force: true });
    },
  };
}
