import { describe, expect, it } from "vitest";
import { formatText } from "../../../src/main/format";

describe("formatText", () => {
  it("pretty-prints JSON with two-space indentation", async () => {
    const result = await formatText("json", '{"a":1,"b":[1,2,  3]}');
    expect(result).toEqual({ ok: true, text: '{ "a": 1, "b": [1, 2, 3] }\n' });
  });

  it("tidies Markdown while preserving the user's own line breaks", async () => {
    const result = await formatText("markdown", "#  Title\n\n- a\n-   b\n");
    expect(result).toEqual({ ok: true, text: "# Title\n\n- a\n- b\n" });
  });

  it("indents HTML children by two spaces", async () => {
    const result = await formatText("html", "<div><p>hi</p><span>x</span></div>");
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.text).toContain("\n  <p>hi</p>");
  });

  it("indents XML elements by two spaces", async () => {
    const result = await formatText("xml", "<a><b>x</b><c/></a>");
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.text).toContain("\n  <b>x</b>");
      expect(result.text).toContain("<c />");
    }
  });

  it("tidies YAML with two-space indentation", async () => {
    const result = await formatText("yaml", "a:   1\nb:\n  - x\n  -   y\n");
    expect(result).toEqual({ ok: true, text: "a: 1\nb:\n  - x\n  - y\n" });
  });

  it("returns ok:false with an error for invalid JSON instead of throwing", async () => {
    const result = await formatText("json", "{ not valid");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/./);
  });

  it("returns ok:false for malformed XML", async () => {
    const result = await formatText("xml", "<a><b></a>");
    expect(result.ok).toBe(false);
  });
});
