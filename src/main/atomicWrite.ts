import type * as Fs from "node:fs";
import { dirname, basename, join } from "node:path";

export type AtomicFs = Pick<typeof Fs, "writeFileSync" | "renameSync" | "mkdirSync" | "unlinkSync"> & {
  promises: Pick<typeof Fs.promises, "writeFile" | "rename" | "mkdir" | "unlink">;
};

let counter = 0;
/** Temp name in the same directory so rename() is atomic on the same filesystem. */
export function tempPathFor(target: string): string {
  counter = (counter + 1) % 1_000_000;
  return join(dirname(target), `.${basename(target)}.tmp-${process.pid}-${counter}`);
}

/** Write via temp + rename. Sync variant for quit paths; small payloads only. */
export function writeAtomicSync(fs: AtomicFs, target: string, data: string): void {
  fs.mkdirSync(dirname(target), { recursive: true });
  const tmp = tempPathFor(target);
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* temp may not exist */
    }
    throw err;
  }
}

export async function writeAtomic(fs: AtomicFs, target: string, data: string): Promise<void> {
  await fs.promises.mkdir(dirname(target), { recursive: true });
  const tmp = tempPathFor(target);
  try {
    await fs.promises.writeFile(tmp, data, "utf8");
    await fs.promises.rename(tmp, target);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => undefined);
    throw err;
  }
}
