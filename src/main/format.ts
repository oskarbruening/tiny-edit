import type { FileFormat } from "../shared/text";
import type { FormatResult } from "../shared/ipc";

/**
 * Pretty-prints Markdown / JSON / HTML / XML with Prettier (2-space indent). Prettier and its
 * plugins are heavy, so they are imported lazily on the first format — nothing is loaded at
 * startup (CLAUDE.md product rule 4). `prettier/standalone` + explicit plugins are used instead
 * of the auto-resolving `prettier` entry so the bundle carries no filesystem plugin lookup.
 *
 * Invalid input (broken JSON/XML, malformed markup) makes Prettier throw; that becomes
 * `{ ok: false }` so the caller can tell the user the file has problems formatting. The text is
 * never altered on a failure.
 */
export async function formatText(format: FileFormat, text: string): Promise<FormatResult> {
  try {
    return { ok: true, text: await runPrettier(format, text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function runPrettier(format: FileFormat, text: string): Promise<string> {
  const prettier = await import("prettier/standalone");
  const base = { tabWidth: 2, useTabs: false } as const;
  switch (format) {
    case "markdown": {
      const markdown = await import("prettier/plugins/markdown");
      // proseWrap "preserve": keep the user's own line breaks in prose instead of reflowing them.
      return prettier.format(text, {
        parser: "markdown",
        plugins: [markdown],
        proseWrap: "preserve",
        ...base,
      });
    }
    case "json": {
      const [babel, estree] = await Promise.all([
        import("prettier/plugins/babel"),
        import("prettier/plugins/estree"),
      ]);
      return prettier.format(text, { parser: "json", plugins: [babel, estree], ...base });
    }
    case "html": {
      const html = await import("prettier/plugins/html");
      return prettier.format(text, { parser: "html", plugins: [html], ...base });
    }
    case "xml": {
      const xml = (await import("@prettier/plugin-xml")).default;
      // Whitespace-sensitivity "ignore" lets the printer re-indent element content (true pretty-print).
      return prettier.format(text, {
        parser: "xml",
        plugins: [xml],
        xmlWhitespaceSensitivity: "ignore",
        ...base,
      });
    }
    case "yaml": {
      const yaml = await import("prettier/plugins/yaml");
      return prettier.format(text, { parser: "yaml", plugins: [yaml], ...base });
    }
  }
}
