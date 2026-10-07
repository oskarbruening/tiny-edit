import { themeCssVars, type Theme } from "../../shared/themes";

/** Sets every `--te-*` variable plus `data-appearance` and `color-scheme` on the root element. */
export function applyTheme(root: HTMLElement, theme: Theme): void {
  for (const [name, value] of Object.entries(themeCssVars(theme.tokens))) root.style.setProperty(name, value);
  root.dataset["appearance"] = theme.appearance;
  root.dataset["theme"] = theme.id;
  root.style.colorScheme = theme.appearance;
}
