import { describe, expect, it } from "vitest";
import { applyTheme } from "../../../src/renderer/theme/apply";
import { CATPPUCCIN_MOCHA, MEADOW } from "../../../src/shared/themes";

describe("applyTheme", () => {
  it("sets variables, appearance, id and colour-scheme on the root", () => {
    const root = document.createElement("html");
    applyTheme(root, CATPPUCCIN_MOCHA);
    expect(root.style.getPropertyValue("--te-surface")).toBe("#1e1e2e");
    expect(root.style.getPropertyValue("--te-syntax-keyword")).toBe("#cba6f7");
    expect(root.dataset["appearance"]).toBe("dark");
    expect(root.dataset["theme"]).toBe("catppuccin-mocha");
    expect(root.style.colorScheme).toBe("dark");
    applyTheme(root, MEADOW);
    expect(root.style.getPropertyValue("--te-surface")).toBe("#fbf9f7");
    expect(root.dataset["appearance"]).toBe("light");
  });
});
