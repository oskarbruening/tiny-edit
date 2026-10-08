import type * as Fs from "node:fs";
import { dirname, basename, join } from "node:path";

export type AtomicFs = Pick<typeof Fs, "writeFileSync" | "renameSync" | "mkdirSync" | "unlinkSync"> & {
  promises: Pick<typeof Fs.promises, "open" | "rename" | "mkdir" | "unlink" | "stat" | "chmod">;
};

let counter = 0;
/** Temp name in the same directory so rename() is atomic on the same filesystem. */
export function tempPathFor(target: string): string {
  counter = (counter + 1) % 1_000_000;
  return join(dirname(target), `.${basename(target)}.tmp-${process.pid}-${counter}`);
}

/** Write via temp + rename. Sync variant for quit paths; small payloads only (our own state file). */
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

/**
 * Atomic write for the user's files: temp file in the same directory, fsync, rename. The
 * target's permission bits are carried over to the new inode (a private 0600 note stays
 * private); ownership, extended attributes and extra hard links cannot survive a rename.
 */
export async function writeAtomic(fs: AtomicFs, target: string, data: string): Promise<void> {
  await fs.promises.mkdir(dirname(target), { recursive: true });
  const mode = await fs.promises.stat(target).then(
    (st) => st.mode & 0o7777,
    () => null,
  );
  const tmp = tempPathFor(target);
  try {
    const handle = await fs.promises.open(tmp, "w", mode ?? 0o644);
    try {
      await handle.writeFile(data, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    // open() applies the umask; chmod sets the exact bits the original had.
    if (mode !== null) await fs.promises.chmod(tmp, mode);
    await fs.promises.rename(tmp, target);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => undefined);
    throw err;
  }
}
