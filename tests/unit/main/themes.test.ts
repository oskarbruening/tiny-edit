import * as fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserThemes } from "../../../src/main/themes";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tiny-edit-themes-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const realFs = { promises: fs.promises, watch: (d: string, l: () => void) => fs.watch(d, l) };

describe("UserThemes", () => {
  it("creates the folder, loads valid files sorted, skips invalid ones with a report", async () => {
    const themesDir = join(dir, "themes");
    fs.mkdirSync(themesDir);
    fs.writeFileSync(
      join(themesDir, "b-solar.json"),
      JSON.stringify({ name: "Solar", colors: { surface: "#fdf6e3" } }),
    );
    fs.writeFileSync(join(themesDir, "a-night.json"), JSON.stringify({ id: "night", appearance: "dark" }));
    fs.writeFileSync(join(themesDir, "broken.json"), "{ nope");
    fs.writeFileSync(join(themesDir, "dup.json"), JSON.stringify({ id: "night" }));
    fs.writeFileSync(join(themesDir, "meadow.json"), JSON.stringify({ name: "shadowing a built-in" }));
    fs.writeFileSync(join(themesDir, "notes.txt"), "ignored");
    fs.writeFileSync(join(themesDir, ".hidden.json"), "{}");
    const onError = vi.fn();
    const themes = new UserThemes({ dir: themesDir, fs: realFs, onChange: vi.fn(), onError });
    const list = await themes.start();
    expect(list.map((t) => t.id)).toEqual(["night", "b-solar"]);
    expect(list[1]!.name).toBe("Solar");
    const messages = onError.mock.calls.map((c) => (c[0] as Error).message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("broken.json"),
        expect.stringContaining("dup.json: duplicate"),
        expect.stringContaining("meadow.json: unusable"),
      ]),
    );
    expect(themes.current).toBe(list);
    themes.close();
  });

  it("creates a missing folder and starts empty", async () => {
    const themesDir = join(dir, "fresh", "themes");
    const themes = new UserThemes({ dir: themesDir, fs: realFs, onChange: vi.fn() });
    expect(await themes.start()).toEqual([]);
    expect(fs.existsSync(themesDir)).toBe(true);
    themes.close();
  });

  it("hot-reloads (debounced) when the folder changes", async () => {
    vi.useFakeTimers();
    try {
      const themesDir = join(dir, "themes");
      let fire: (() => void) | null = null;
      const fakeFs = {
        promises: fs.promises,
        watch: (_d: string, l: () => void) => ((fire = l), { close: vi.fn() }),
      };
      const onChange = vi.fn();
      const themes = new UserThemes({ dir: themesDir, fs: fakeFs, onChange, debounceMs: 200 });
      await themes.start();
      fs.writeFileSync(join(themesDir, "new.json"), JSON.stringify({ name: "New" }));
      fire!();
      fire!(); // two events → one reload
      await vi.advanceTimersByTimeAsync(199);
      expect(onChange).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
      expect(themes.current.map((t) => t.id)).toEqual(["new"]);
      themes.close();
      themes.close(); // idempotent
      fire!();
      await vi.advanceTimersByTimeAsync(500);
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports but survives an unreadable folder and a failing watch", async () => {
    const onError = vi.fn();
    const broken = {
      promises: {
        ...fs.promises,
        mkdir: async () => {
          throw new Error("EACCES mkdir");
        },
        readdir: async () => {
          throw new Error("EACCES readdir");
        },
      },
      watch: () => {
        throw new Error("watch failed");
      },
    };
    const themes = new UserThemes({ dir: join(dir, "x"), fs: broken as never, onChange: vi.fn(), onError });
    expect(await themes.start()).toEqual([]);
    expect(onError.mock.calls.map((c) => (c[0] as Error).message)).toEqual([
      "EACCES mkdir",
      "EACCES readdir",
      "watch failed",
    ]);
  });

  it("warns through console by default", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const themes = new UserThemes({
      dir: join(dir, "t"),
      fs: {
        ...realFs,
        watch: () => {
          throw new Error("x");
        },
      },
      onChange: vi.fn(),
    });
    await themes.start();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
