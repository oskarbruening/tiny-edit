// Symlinks the `tiny-edit` shim (bin/tiny-edit) onto the user's PATH so files can be opened from a
// terminal. Picks the first writable directory already on PATH among a short list of the usual
// macOS locations, preferring /usr/local/bin. Run with `npm run install:cli`.
import { chmodSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { accessSync, constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const shim = resolve(here, "..", "bin", "tiny-edit");
if (!existsSync(shim)) {
  console.error(`Shim not found at ${shim}`);
  process.exit(1);
}
chmodSync(shim, 0o755);

const pathDirs = (process.env.PATH ?? "").split(":").filter(Boolean);
const onPath = (dir) => pathDirs.includes(dir);
const writable = (dir) => {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

// Candidates in preference order. ~/.local/bin is created if missing (it is only useful when the
// user has it on PATH, which we check and warn about).
const localBin = join(homedir(), ".local", "bin");
const candidates = ["/usr/local/bin", "/opt/homebrew/bin", localBin];

let target = candidates.find((dir) => existsSync(dir) && writable(dir));
if (!target && !existsSync(localBin)) {
  mkdirSync(localBin, { recursive: true });
  target = localBin;
}

if (!target) {
  console.error("No writable directory found among:", candidates.join(", "));
  console.error("Re-run with elevated permissions, e.g.:  sudo ln -sf", shim, "/usr/local/bin/tiny-edit");
  process.exit(1);
}

const link = join(target, "tiny-edit");
// Replace an existing symlink/file we are managing; refuse to clobber a real unrelated file.
if (existsSync(link) || isDanglingLink(link)) {
  if (lstatSync(link).isSymbolicLink()) rmSync(link);
  else {
    console.error(`${link} already exists and is not a symlink; remove it first.`);
    process.exit(1);
  }
}
symlinkSync(shim, link);
console.log(`Linked ${link} -> ${shim}`);
if (!onPath(target)) {
  console.warn(`Note: ${target} is not on your PATH. Add it, e.g.:`);
  console.warn(`  echo 'export PATH="${target}:$PATH"' >> ~/.zshrc`);
}
console.log(
  'Usage: tiny-edit <file>   (open files in Tiny Edit; "npm run install:app" installs the app itself)',
);

function isDanglingLink(p) {
  try {
    readlinkSync(p);
    return true;
  } catch {
    return false;
  }
}
