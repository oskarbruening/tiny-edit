import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Settings,
  SETTINGS_TITLE,
  themeLabel,
  type SettingsSnapshot,
} from "../../../../src/renderer/settings/settings";
import { defaultState } from "../../../../src/shared/state";
import { BUILTIN_THEMES, MEADOW } from "../../../../src/shared/themes";

const snapshot = (over: Partial<SettingsSnapshot> = {}): SettingsSnapshot => ({
  theme: defaultState().theme,
  fontSize: 14,
  highlight: true,
  themes: BUILTIN_THEMES,
  ...over,
});

function make() {
  const host = document.createElement("div");
  document.body.append(host);
  const hooks = { onTheme: vi.fn(), onFontSize: vi.fn(), onHighlight: vi.fn(), onClose: vi.fn() };
  const settings = new Settings(host, hooks);
  const q = <T extends Element>(sel: string) => host.querySelector<T>(sel)!;
  return { host, hooks, settings, q };
}

beforeEach(() => document.body.replaceChildren());

describe("Settings", () => {
  it("builds a hidden dialog with title, theme controls, slider, highlight switch and Done", () => {
    const { host, q } = make();
    expect(host.hidden).toBe(true);
    expect(host.classList.contains("settings")).toBe(true);
    expect(q(".settings__panel").getAttribute("role")).toBe("dialog");
    expect(q(".settings__title").textContent).toBe(SETTINGS_TITLE);
    expect(q<HTMLInputElement>(".settings__font").type).toBe("range");
    expect(q<HTMLInputElement>(".settings__font").min).toBe("1");
    expect(q<HTMLInputElement>(".settings__font").max).toBe("5");
    expect(q<HTMLInputElement>("#settings-highlight").type).toBe("checkbox");
    expect(q<HTMLLabelElement>("label[for='settings-highlight']").textContent).toBe("Syntax highlighting");
    expect([...host.querySelectorAll(".settings__heading")].map((h) => h.textContent)).toEqual([
      "Theme",
      "Editor",
    ]);
    expect(q(".settings__done").textContent).toBe("Done");
  });

  it("update() reflects mode, selections, enablement and the nearest font step", () => {
    const { settings, q } = make();
    settings.update(snapshot());
    expect(q<HTMLInputElement>("#settings-mode-auto").checked).toBe(true);
    expect(q<HTMLInputElement>("#settings-mode-fixed").checked).toBe(false);
    const light = q<HTMLSelectElement>(".settings__light");
    const dark = q<HTMLSelectElement>(".settings__dark");
    const fixed = q<HTMLSelectElement>(".settings__fixed");
    expect([...light.options].map((o) => o.textContent)).toEqual(["Meadow", "Catppuccin Latte"]);
    expect([...dark.options].map((o) => o.value)).toEqual([
      "tokyo-night",
      "catppuccin-frappe",
      "catppuccin-macchiato",
      "catppuccin-mocha",
      "macos-dark",
    ]);
    expect(light.value).toBe("meadow");
    expect(dark.value).toBe("catppuccin-mocha");
    expect(fixed.options).toHaveLength(7);
    expect(fixed.disabled).toBe(true);
    expect(light.disabled).toBe(false);
    expect(q<HTMLInputElement>(".settings__font").value).toBe("3");
    expect(q(".settings__font-value").textContent).toBe("14 px");
    expect(q<HTMLInputElement>("#settings-highlight").checked).toBe(true);

    settings.update(
      snapshot({
        theme: { mode: "fixed", light: "meadow", dark: "tokyo-night", fixed: "catppuccin-latte" },
        fontSize: 11,
        highlight: false,
      }),
    );
    expect(q<HTMLInputElement>("#settings-highlight").checked).toBe(false);
    expect(q<HTMLInputElement>("#settings-mode-fixed").checked).toBe(true);
    expect(fixed.disabled).toBe(false);
    expect(light.disabled).toBe(true);
    expect(dark.disabled).toBe(true);
    expect(fixed.value).toBe("catppuccin-latte");
    expect(dark.value).toBe("tokyo-night");
    expect(q<HTMLInputElement>(".settings__font").value).toBe("2");
    expect(q(".settings__font-value").textContent).toBe("12 px");
  });

  it("labels custom themes like the menu and leaves a vanished theme unselected", () => {
    const { settings, q } = make();
    const mine = { ...MEADOW, id: "mine", name: "Mine", builtin: false };
    expect(themeLabel(mine)).toBe("Mine (custom)");
    expect(themeLabel(MEADOW)).toBe("Meadow");
    settings.update(
      snapshot({
        themes: [...BUILTIN_THEMES, mine],
        theme: { mode: "fixed", light: "meadow", dark: "catppuccin-mocha", fixed: "gone" },
      }),
    );
    const fixed = q<HTMLSelectElement>(".settings__fixed");
    expect([...fixed.options].map((o) => o.textContent)).toContain("Mine (custom)");
    expect(fixed.selectedIndex).toBe(-1);
  });

  it("reports theme changes with the rest of the theme state intact", () => {
    const { settings, hooks, q } = make();
    settings.update(snapshot());
    const fixedRadio = q<HTMLInputElement>("#settings-mode-fixed");
    fixedRadio.checked = true;
    fixedRadio.dispatchEvent(new Event("change"));
    expect(hooks.onTheme).toHaveBeenLastCalledWith({ ...defaultState().theme, mode: "fixed" });

    const autoRadio = q<HTMLInputElement>("#settings-mode-auto");
    autoRadio.checked = true;
    fixedRadio.checked = false;
    autoRadio.dispatchEvent(new Event("change"));
    expect(hooks.onTheme).toHaveBeenLastCalledWith({ ...defaultState().theme, mode: "auto" });

    const light = q<HTMLSelectElement>(".settings__light");
    light.value = "catppuccin-latte";
    light.dispatchEvent(new Event("change"));
    expect(hooks.onTheme).toHaveBeenLastCalledWith({ ...defaultState().theme, light: "catppuccin-latte" });

    const dark = q<HTMLSelectElement>(".settings__dark");
    dark.value = "tokyo-night";
    dark.dispatchEvent(new Event("change"));
    expect(hooks.onTheme).toHaveBeenLastCalledWith({ ...defaultState().theme, dark: "tokyo-night" });

    const fixed = q<HTMLSelectElement>(".settings__fixed");
    fixed.value = "catppuccin-frappe";
    fixed.dispatchEvent(new Event("change"));
    expect(hooks.onTheme).toHaveBeenLastCalledWith({ ...defaultState().theme, fixed: "catppuccin-frappe" });
    expect(hooks.onTheme).toHaveBeenCalledTimes(5);
  });

  it("ignores theme control events before the first update(); the slider clamps garbage", () => {
    const { hooks, q } = make();
    q<HTMLInputElement>("#settings-mode-fixed").dispatchEvent(new Event("change"));
    q<HTMLSelectElement>(".settings__fixed").dispatchEvent(new Event("change"));
    expect(hooks.onTheme).not.toHaveBeenCalled();
    const slider = q<HTMLInputElement>(".settings__font");
    slider.value = "9"; // the DOM clamps to max
    slider.dispatchEvent(new Event("input"));
    expect(hooks.onFontSize).toHaveBeenLastCalledWith(18);
    slider.value = "abc"; // non-numeric: the DOM resets a range to its midpoint
    slider.dispatchEvent(new Event("input"));
    expect(hooks.onFontSize).toHaveBeenLastCalledWith(14);
  });

  it("reports the highlight switch as a boolean", () => {
    const { settings, hooks, q } = make();
    settings.update(snapshot());
    const box = q<HTMLInputElement>("#settings-highlight");
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(hooks.onHighlight).toHaveBeenLastCalledWith(false);
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect(hooks.onHighlight).toHaveBeenLastCalledWith(true);
    expect(hooks.onHighlight).toHaveBeenCalledTimes(2);
  });

  it("maps slider steps to px and shows the value live", () => {
    const { settings, hooks, q } = make();
    settings.update(snapshot());
    const slider = q<HTMLInputElement>(".settings__font");
    for (const [step, px] of [
      ["1", 10],
      ["2", 12],
      ["3", 14],
      ["4", 16],
      ["5", 18],
    ] as const) {
      slider.value = step;
      slider.dispatchEvent(new Event("input"));
      expect(hooks.onFontSize).toHaveBeenLastCalledWith(px);
      expect(q(".settings__font-value").textContent).toBe(`${px} px`);
    }
  });

  it("opens, toggles, closes on Esc / backdrop / Done, and reports close once", () => {
    const { settings, hooks, host, q } = make();
    settings.update(snapshot());
    settings.open();
    expect(settings.visible).toBe(true);
    expect(document.activeElement).toBe(q(".settings__panel"));
    settings.open(); // idempotent
    settings.toggle();
    expect(settings.visible).toBe(false);
    expect(hooks.onClose).toHaveBeenCalledTimes(1);
    settings.close(); // already closed: no second report
    expect(hooks.onClose).toHaveBeenCalledTimes(1);

    settings.toggle();
    expect(settings.visible).toBe(true);
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(settings.visible).toBe(false);

    settings.open();
    q(".settings__panel").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); // inside: stays
    expect(settings.visible).toBe(true);
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })); // other keys: stays
    expect(settings.visible).toBe(true);
    host.dispatchEvent(new MouseEvent("mousedown")); // backdrop
    expect(settings.visible).toBe(false);

    settings.open();
    q<HTMLButtonElement>(".settings__done").click();
    expect(settings.visible).toBe(false);
    expect(hooks.onClose).toHaveBeenCalledTimes(4);
  });
});
