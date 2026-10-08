import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { toml as tomlMode } from "@codemirror/legacy-modes/mode/toml";
import { LanguageDescription, LanguageSupport, StreamLanguage, type Language } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { extensionOf, formatOf } from "../../shared/text";

/** TOML has no Lezer grammar; the legacy stream mode gives it string/comment/number colouring. */
const tomlLanguage = StreamLanguage.define(tomlMode);
const tomlSupport = (): LanguageSupport => new LanguageSupport(tomlLanguage);

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
    load: async () => json(),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html", "htm", "svg"],
    load: async () => html(),
  }),
  LanguageDescription.of({
    name: "XML",
    alias: ["xml"],
    load: async () => xml(),
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
    load: async () => yaml(),
  }),
  LanguageDescription.of({
    name: "TOML",
    alias: ["toml"],
    load: async () => tomlSupport(),
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

/**
 * Top-level grammar for a file by type: JSON/HTML/XML/YAML/TOML get their own, everything else
 * (Markdown, plain text, source code) stays Markdown (`null` → the caller's default Markdown
 * support). SVG is XML; `.htm`/`.html` are HTML; `.yml` is YAML. TOML highlights but is not in the
 * Pretty Format set, so it is matched on extension here rather than through `formatOf`.
 * Highlighting only — the text is never reformatted on open.
 */
export function topLanguage(path: string): Extension | null {
  switch (formatOf(path)) {
    case "json":
      return json();
    case "html":
      return html();
    case "xml":
      return xml();
    case "yaml":
      return yaml();
    default:
      return extensionOf(path) === ".toml" ? tomlSupport() : null;
  }
}

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
