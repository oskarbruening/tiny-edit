import { describe, expect, it } from "vitest";
import { forgetOpened, recentItems, rememberClosed } from "../../../src/main/recent";
import { MAX_RECENTLY_CLOSED } from "../../../src/shared/state";

describe("rememberClosed", () => {
  it("puts the newest at the front and keeps entries unique", () => {
    let list: string[] = [];
    list = rememberClosed(list, "/a.md");
    list = rememberClosed(list, "/b.md");
    expect(list).toEqual(["/b.md", "/a.md"]);
    // Re-closing an existing path moves it back to the top, never duplicating it.
    list = rememberClosed(list, "/a.md");
    expect(list).toEqual(["/a.md", "/b.md"]);
  });

  it("caps the list at MAX_RECENTLY_CLOSED, dropping the oldest", () => {
    let list: string[] = [];
    for (let i = 0; i < MAX_RECENTLY_CLOSED + 10; i++) list = rememberClosed(list, `/f${i}.md`);
    expect(list).toHaveLength(MAX_RECENTLY_CLOSED);
    expect(list[0]).toBe(`/f${MAX_RECENTLY_CLOSED + 9}.md`);
    expect(list).not.toContain("/f0.md");
  });
});

describe("forgetOpened", () => {
  it("drops the given paths and leaves the rest in order", () => {
    expect(forgetOpened(["/a", "/b", "/c"], ["/b"])).toEqual(["/a", "/c"]);
    expect(forgetOpened(["/a", "/b"], ["/x"])).toEqual(["/a", "/b"]);
    expect(forgetOpened(["/a", "/b"], [])).toEqual(["/a", "/b"]);
  });
});

describe("recentItems", () => {
  it("shows the name alone when unique, and name + folder when two share a name", () => {
    const items = recentItems(
      ["/Users/me/work/todo.md", "/Users/me/personal/todo.md", "/x/notes.txt"],
      "/Users/me",
    );
    expect(items).toEqual([
      { path: "/Users/me/work/todo.md", label: "todo.md — ~/work" },
      { path: "/Users/me/personal/todo.md", label: "todo.md — ~/personal" },
      { path: "/x/notes.txt", label: "notes.txt" },
    ]);
  });

  it("keeps full names with extensions so a.md and a.txt are not confused", () => {
    const items = recentItems(["/x/a.md", "/x/a.txt"], "/Users/me");
    expect(items.map((i) => i.label)).toEqual(["a.md", "a.txt"]);
  });
});
