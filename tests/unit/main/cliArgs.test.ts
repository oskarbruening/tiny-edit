import { describe, expect, it } from "vitest";
import { fileArgsFrom } from "../../../src/main/cliArgs";

describe("fileArgsFrom", () => {
  it("packaged argv is [exec, ...files]: keeps from index 1", () => {
    expect(fileArgsFrom(["/Apps/Tiny Edit", "/abs/a.md", "/abs/b.txt"], "/cwd", true)).toEqual([
      "/abs/a.md",
      "/abs/b.txt",
    ]);
  });

  it("dev/E2E argv is [electron, '.', ...files]: skips the app-path slot too", () => {
    expect(fileArgsFrom(["/bin/electron", ".", "/abs/a.md"], "/cwd", false)).toEqual(["/abs/a.md"]);
  });

  it("resolves relative paths against the working directory", () => {
    expect(fileArgsFrom(["/exec", "notes/todo.md", "../up.txt"], "/home/me", true)).toEqual([
      "/home/me/notes/todo.md",
      "/home/up.txt",
    ]);
  });

  it("drops Electron/Chromium switches and macOS's -psn argument", () => {
    expect(
      fileArgsFrom(["/exec", "-psn_0_12345", "--inspect=9229", "/abs/a.md", "--no-sandbox"], "/cwd", true),
    ).toEqual(["/abs/a.md"]);
  });

  it("treats everything after -- as a positional path, even a leading dash", () => {
    expect(fileArgsFrom(["/exec", "--", "-weird-name.md", "/abs/b.md"], "/cwd", true)).toEqual([
      "/cwd/-weird-name.md",
      "/abs/b.md",
    ]);
  });

  it("ignores empty strings and returns [] when there are no file args", () => {
    expect(fileArgsFrom(["/exec", "", "--flag"], "/cwd", true)).toEqual([]);
    expect(fileArgsFrom(["/exec"], "/cwd", true)).toEqual([]);
  });
});
