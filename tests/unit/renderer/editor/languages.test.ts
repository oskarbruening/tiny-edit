import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { codeLanguages, genericLanguage, languageFor } from "../../../../src/renderer/editor/languages";
import { editorExtensions } from "../../../../src/renderer/editor/extensions";

describe("languageFor", () => {
  it("matches names and aliases case-insensitively, using only the first word of the info string", () => {
    expect(languageFor("js")?.name).toBe("JavaScript");
    expect(languageFor("TypeScript")?.name).toBe("TypeScript");
    expect(languageFor("tsx")?.name).toBe("TypeScript");
    expect(languageFor("py title=x")?.name).toBe("Python");
    expect(languageFor("bash")?.name).toBe("Shell");
    expect(languageFor("yml")?.name).toBe("YAML");
    expect(languageFor("golang")?.name).toBe("Go");
    expect(languageFor("rs")?.name).toBe("Rust");
    expect(languageFor("postgres")?.name).toBe("SQL");
    expect(languageFor("htm")?.name).toBe("HTML");
    expect(languageFor("scss")?.name).toBe("CSS");
    expect(languageFor("jsonc")?.name).toBe("JSON");
  });
  it("returns null for unknown or empty info", () => {
    expect(languageFor("")).toBeNull();
    expect(languageFor("   ")).toBeNull();
    expect(languageFor("brainfuck")).toBeNull();
  });
  it("every description loads a real grammar", async () => {
    for (const desc of codeLanguages) {
      const support = await desc.load();
      expect(support.language, desc.name).toBeDefined();
    }
  }, 20_000);
});

describe("genericLanguage", () => {
  function tokens(doc: string): string[] {
    const state = EditorState.create({ doc, extensions: [genericLanguage] });
    const tree = ensureSyntaxTree(state, doc.length, 5000)!;
    const out: string[] = [];
    tree.iterate({
      enter: (n) => {
        if (n.name !== tree.type.name) out.push(`${n.name}:${doc.slice(n.from, n.to)}`);
      },
    });
    return out;
  }
  it("colours strings, comments and numbers only", () => {
    const got = tokens(`x = "a\\"b" + 'c' + \`d\` # note\nlet y = 42.5 -- dash\n/* multi\nline */ z`);
    expect(got).toEqual(
      expect.arrayContaining([
        'string:"a\\"b"',
        "string:'c'",
        "string:`d`",
        "comment:# note",
        "number:42.5",
        "comment:-- dash",
      ]),
    );
    expect(
      got.filter((t) => t.startsWith("comment:/* multi")).length +
        got.filter((t) => t.startsWith("comment:line */")).length,
    ).toBeGreaterThan(0);
    expect(got.some((t) => t.includes("x ="))).toBe(false);
  });
  it("handles an unterminated string and a // comment", () => {
    const got = tokens(`"open\n// c`);
    expect(got).toEqual(expect.arrayContaining(['string:"open', "comment:// c"]));
  });
});

describe("fenced code in the editor", () => {
  it("uses the generic language for unknown fences and loads the named grammar on demand", async () => {
    const doc = '```whatever\nx = "s" # c\n```\n\n```js\nconst a = 1;\n```\n';
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc, extensions: editorExtensions() }),
    });
    try {
      const texts = (sel: string) => [...view.contentDOM.querySelectorAll(sel)].map((n) => n.textContent);
      expect(texts(".te-string")).toEqual(['"s"']);
      expect(texts(".te-comment")).toEqual(["# c"]);
      expect(texts(".te-code-fence")).toEqual(["whatever", "js"]);
      // The JS grammar arrives asynchronously, then the keyword is coloured.
      await vi.waitFor(() => expect(texts(".te-keyword")).toEqual(["const"]), { timeout: 5000 });
      expect(texts(".te-number")).toEqual(["1"]);
    } finally {
      view.destroy();
    }
  });
});
