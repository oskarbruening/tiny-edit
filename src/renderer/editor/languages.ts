import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { LanguageDescription, LanguageSupport, StreamLanguage, type Language } from "@codemirror/language";

/**
 * Fenced-code languages (Q22). Grammars load on first use so launch stays light, except
 * HTML/CSS/JS, which `@codemirror/lang-markdown` already bundles (Markdown may contain HTML).
 */
export const codeLanguages: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "jsx", "mjs", "cjs", "javascript"],
    load: async () => javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts", "tsx", "mts", "cts", "typescript"],
    load: async () => javascript({ jsx: true, typescript: true }),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json", "jsonc"],
    load: () => import("@codemirror/lang-json").then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html", "htm", "xml", "svg"],
    load: async () => html(),
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["css", "scss"],
    load: async () => css(),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py", "python", "python3"],
    load: () => import("@codemirror/lang-python").then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: "Shell",
    alias: ["sh", "bash", "zsh", "shell", "console"],
    load: () =>
      import("@codemirror/legacy-modes/mode/shell").then(
        (m) => new LanguageSupport(StreamLanguage.define(m.shell)),
      ),
  }),
  LanguageDescription.of({
    name: "SQL",
    alias: ["sql", "postgres", "postgresql", "mysql", "sqlite"],
    load: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yaml", "yml"],
    load: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  }),
  LanguageDescription.of({
    name: "Go",
    alias: ["go", "golang"],
    load: () => import("@codemirror/lang-go").then((m) => m.go()),
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: ["rs", "rust"],
    load: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  }),
];

/** The language used for a fence info string, or null (→ defaultCodeLanguage). Markdown nests itself. */
export function languageFor(info: string): LanguageDescription | null {
  const name = info.trim().split(/\s+/)[0] ?? "";
  if (!name) return null;
  return LanguageDescription.matchLanguageName(codeLanguages, name, true);
}

/**
 * Fallback for unknown fence languages: strings, comments and numbers get colour, and the
 * rainbow plugin handles brackets. Deliberately simple so it is never wrong in a loud way.
 */
export const genericLanguage: Language = StreamLanguage.define<{ block: string | null }>({
  startState: () => ({ block: null }),
  token(stream, state) {
    if (state.block) {
      if (stream.match(state.block)) state.block = null;
      else stream.next();
      return "comment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("/*")) {
      state.block = "*/";
      return "comment";
    }
    if (stream.match("//") || stream.match("--") || stream.match("#")) {
      stream.skipToEnd();
      return "comment";
    }
    const quote = stream.peek();
    if (quote === '"' || quote === "'" || quote === "`") {
      stream.next();
      let escaped = false;
      while (!stream.eol()) {
        const ch = stream.next();
        if (!escaped && ch === quote) return "string";
        escaped = !escaped && ch === "\\";
      }
      return "string";
    }
    if (stream.match(/^\d+(\.\d+)?/)) return "number";
    stream.next();
    return null;
  },
});
