import { MAX_RECENTLY_CLOSED } from "../shared/state";
import { abbreviateHome, baseName, parentDir } from "../shared/text";

/**
 * File → Recently Closed list logic. The list holds paths removed from the sidebar, most recent
 * first, unique, capped. Invariant kept by the callers: a path currently in the sidebar is never
 * in this list (opening removes it; removing adds it).
 */

/** Records a just-closed path at the front, moving an existing copy up, capped at the max. */
export function rememberClosed(list: readonly string[], path: string): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, MAX_RECENTLY_CLOSED);
}

/** Drops paths that were (re)opened or proved missing, so they never show while listed. */
export function forgetOpened(list: readonly string[], paths: readonly string[]): string[] {
  if (paths.length === 0) return [...list];
  const gone = new Set(paths);
  return list.filter((p) => !gone.has(p));
}

/**
 * Menu labels for the list: the file name alone, with its containing folder (home-abbreviated)
 * appended only when another entry shares the same name, so same-named files from different
 * folders are told apart while the common case stays clean. Distinct paths with the same name
 * always differ by folder, so the disambiguated label is unique.
 */
export function recentItems(paths: readonly string[], home: string): { path: string; label: string }[] {
  const names = paths.map(baseName);
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return paths.map((path, i) => {
    const name = names[i]!;
    const label = (counts.get(name) ?? 0) > 1 ? `${name} — ${abbreviateHome(parentDir(path), home)}` : name;
    return { path, label };
  });
}
