import { FONT_SLIDER_RANGE, type ThemeState } from "../../shared/state";
import type { Appearance, Theme } from "../../shared/themes";

export type SettingsSnapshot = {
  theme: ThemeState;
  fontSize: number;
  highlight: boolean;
  themes: readonly Theme[];
};

export type SettingsHooks = {
  onTheme: (theme: ThemeState) => void;
  onFontSize: (px: number) => void;
  onHighlight: (on: boolean) => void;
  /** After the panel closes (the app gives focus back to the editor). */
  onClose?: () => void;
};

export const SETTINGS_TITLE = "Settings";

/**
 * The in-window Settings panel (App menu → Settings…, Cmd+,): theme mode and pick, the
 * font-size slider (1 px steps) and the syntax-highlighting switch. Pure DOM; the app feeds it state via `update()` and persists
 * what the hooks report. Esc, the backdrop and Done close it.
 */
export class Settings {
  private readonly panel: HTMLElement;
  private readonly modeAuto: HTMLInputElement;
  private readonly modeFixed: HTMLInputElement;
  private readonly fixedSelect: HTMLSelectElement;
  private readonly lightSelect: HTMLSelectElement;
  private readonly darkSelect: HTMLSelectElement;
  private readonly fontSlider: HTMLInputElement;
  private readonly fontValue: HTMLElement;
  private readonly highlightBox: HTMLInputElement;
  private snapshot: SettingsSnapshot | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly hooks: SettingsHooks,
  ) {
    host.classList.add("settings");
    host.hidden = true;
    host.addEventListener("mousedown", (e) => {
      if (e.target === host) this.close();
    });
    host.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if (e.key === "Tab") this.trapTab(e);
    });

    this.panel = el("section", "settings__panel");
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-modal", "true");
    this.panel.setAttribute("aria-labelledby", "settings-title");
    this.panel.tabIndex = -1;

    const title = el("h1", "settings__title");
    title.id = "settings-title";
    title.textContent = SETTINGS_TITLE;

    // ── Theme ──
    this.modeAuto = radio("settings-mode", "auto");
    this.modeFixed = radio("settings-mode", "fixed");
    const onMode = (): void => {
      const theme = this.snapshot?.theme;
      if (theme) this.hooks.onTheme({ ...theme, mode: this.modeFixed.checked ? "fixed" : "auto" });
    };
    this.modeAuto.addEventListener("change", onMode);
    this.modeFixed.addEventListener("change", onMode);

    this.fixedSelect = el("select", "settings__select settings__fixed");
    this.lightSelect = el("select", "settings__select settings__light");
    this.darkSelect = el("select", "settings__select settings__dark");
    const onPick = (key: "fixed" | "light" | "dark", select: HTMLSelectElement) => (): void => {
      const theme = this.snapshot?.theme;
      if (theme && select.value) this.hooks.onTheme({ ...theme, [key]: select.value });
    };
    this.fixedSelect.addEventListener("change", onPick("fixed", this.fixedSelect));
    this.lightSelect.addEventListener("change", onPick("light", this.lightSelect));
    this.darkSelect.addEventListener("change", onPick("dark", this.darkSelect));

    const themeSection = section("Theme", [
      row(labelFor(this.modeAuto, "Automatic (follows macOS)"), null),
      row(labelText("Light", this.lightSelect), this.lightSelect, "settings__row--indent"),
      row(labelText("Dark", this.darkSelect), this.darkSelect, "settings__row--indent"),
      row(labelFor(this.modeFixed, "Fixed"), null),
      row(labelText("Theme", this.fixedSelect), this.fixedSelect, "settings__row--indent"),
    ]);

    // ── Editor ──
    this.fontSlider = el("input", "settings__font");
    this.fontSlider.type = "range";
    this.fontSlider.min = String(FONT_SLIDER_RANGE.min);
    this.fontSlider.max = String(FONT_SLIDER_RANGE.max);
    this.fontSlider.step = "1";
    this.fontSlider.addEventListener("input", () => {
      // A range input only ever holds an integer in [min, max] (the DOM sanitises its value).
      const px = Number(this.fontSlider.value);
      this.fontValue.textContent = `${px} px`;
      this.hooks.onFontSize(px);
    });
    this.fontValue = el("output", "settings__font-value");
    const fontRow = row(labelText("Font size", this.fontSlider), this.fontSlider);
    fontRow.append(this.fontValue);
    this.highlightBox = el("input", "settings__highlight");
    this.highlightBox.type = "checkbox";
    this.highlightBox.id = "settings-highlight";
    this.highlightBox.addEventListener("change", () => this.hooks.onHighlight(this.highlightBox.checked));
    const editorSection = section("Editor", [
      fontRow,
      row(labelFor(this.highlightBox, "Syntax highlighting"), null),
    ]);

    // ── Footer ──
    const done = el("button", "settings__done");
    done.type = "button";
    done.textContent = "Done";
    done.addEventListener("click", () => this.close());
    const footer = el("footer", "settings__footer");
    footer.append(done);

    this.panel.append(title, themeSection, editorSection, footer);
    host.append(this.panel);
  }

  /** Re-renders every control from the given state. Safe to call while open. */
  update(snapshot: SettingsSnapshot): void {
    this.snapshot = snapshot;
    const { theme, themes, fontSize, highlight } = snapshot;
    const auto = theme.mode === "auto";
    this.modeAuto.checked = auto;
    this.modeFixed.checked = !auto;
    fillOptions(this.lightSelect, themes.filter(byAppearance("light")), theme.light);
    fillOptions(this.darkSelect, themes.filter(byAppearance("dark")), theme.dark);
    fillOptions(this.fixedSelect, themes, theme.fixed);
    this.lightSelect.disabled = !auto;
    this.darkSelect.disabled = !auto;
    this.fixedSelect.disabled = auto;
    // A zoomed size outside the slider's range pins the thumb to the end but shows the real size.
    this.fontSlider.value = String(
      Math.min(FONT_SLIDER_RANGE.max, Math.max(FONT_SLIDER_RANGE.min, fontSize)),
    );
    this.fontValue.textContent = `${fontSize} px`;
    this.highlightBox.checked = highlight;
  }

  open(): void {
    if (!this.host.hidden) return;
    this.host.hidden = false;
    this.panel.focus();
  }

  /** The dialog is modal: Tab and Shift+Tab cycle inside it instead of reaching the editor behind. */
  private trapTab(e: KeyboardEvent): void {
    const focusable = [...this.panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (n) => !(n as HTMLInputElement).disabled,
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === this.panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  close(): void {
    if (this.host.hidden) return;
    this.host.hidden = true;
    this.hooks.onClose?.();
  }

  toggle(): void {
    if (this.host.hidden) this.open();
    else this.close();
  }

  get visible(): boolean {
    return !this.host.hidden;
  }
}

const FOCUSABLE = "input, select, button, [tabindex]:not([tabindex='-1'])";
const byAppearance = (appearance: Appearance) => (t: Theme) => t.appearance === appearance;

/** Same wording as the View → Theme menu. */
export const themeLabel = (t: Theme): string => (t.builtin ? t.name : `${t.name} (custom)`);

function fillOptions(select: HTMLSelectElement, themes: readonly Theme[], current: string): void {
  select.replaceChildren(
    ...themes.map((t) => {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = themeLabel(t);
      return o;
    }),
  );
  // A current id that is not in the list (deleted user theme) must not silently pick the first entry.
  if (themes.some((t) => t.id === current)) select.value = current;
  else select.selectedIndex = -1;
}

let uid = 0;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
function radio(name: string, value: string): HTMLInputElement {
  const r = el("input", "settings__radio");
  r.type = "radio";
  r.name = name;
  r.value = value;
  r.id = `${name}-${value}`;
  return r;
}
/** A label wrapping a radio or checkbox, with the text after the control. */
function labelFor(input: HTMLInputElement, text: string): HTMLLabelElement {
  const l = el("label", "settings__label settings__label--radio");
  l.htmlFor = input.id;
  l.append(input, document.createTextNode(text));
  return l;
}
function labelText(text: string, control: HTMLElement): HTMLLabelElement {
  const l = el("label", "settings__label");
  if (!control.id) control.id = `settings-control-${++uid}`;
  l.htmlFor = control.id;
  l.textContent = text;
  return l;
}
function row(label: HTMLElement, control: HTMLElement | null, extraClass = ""): HTMLElement {
  const r = el("div", `settings__row ${extraClass}`.trim());
  r.append(label);
  if (control) r.append(control);
  return r;
}
function section(heading: string, rows: HTMLElement[]): HTMLElement {
  const s = el("section", "settings__section");
  const h = el("h2", "settings__heading");
  h.textContent = heading;
  s.append(h, ...rows);
  return s;
}
