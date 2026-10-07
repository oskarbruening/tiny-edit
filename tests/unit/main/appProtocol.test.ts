import { describe, expect, it, vi } from "vitest";
import {
  createAppProtocolHandler,
  mimeFor,
  RENDERER_ORIGIN,
  RENDERER_URL,
  resolveAppUrl,
} from "../../../src/main/appProtocol";

const root = "/app/out/renderer";

describe("resolveAppUrl", () => {
  it("maps renderer URLs to files under the build root", () => {
    expect(resolveAppUrl(RENDERER_URL, root)).toBe("/app/out/renderer/index.html");
    expect(resolveAppUrl("app://renderer/", root)).toBe("/app/out/renderer/index.html");
    expect(resolveAppUrl("app://renderer/assets/index-abc.js?x=1#y", root)).toBe(
      "/app/out/renderer/assets/index-abc.js",
    );
    expect(resolveAppUrl("app://renderer/assets/with%20space.css", root)).toBe(
      "/app/out/renderer/assets/with space.css",
    );
    expect(RENDERER_URL.startsWith(RENDERER_ORIGIN)).toBe(true);
  });
  it("rejects other schemes, hosts, traversal and garbage", () => {
    expect(resolveAppUrl("file:///etc/passwd", root)).toBeNull();
    expect(resolveAppUrl("app://other/index.html", root)).toBeNull();
    // The URL parser already collapses plain "..": the result stays inside the build root.
    expect(resolveAppUrl("app://renderer/../../etc/passwd", root)).toBe("/app/out/renderer/etc/passwd");
    expect(resolveAppUrl("app://renderer/assets/..%2F..%2F..%2Fetc%2Fpasswd", root)).toBeNull();
    expect(resolveAppUrl("not a url", root)).toBeNull();
  });
});

describe("mimeFor", () => {
  it("knows the build's file types and falls back to octet-stream", () => {
    expect(mimeFor("a.html")).toContain("text/html");
    expect(mimeFor("a.JS")).toContain("text/javascript");
    expect(mimeFor("a.css")).toContain("text/css");
    expect(mimeFor("a.woff2")).toBe("font/woff2");
    expect(mimeFor("a.bin")).toBe("application/octet-stream");
  });
});

describe("createAppProtocolHandler", () => {
  it("serves files with their mime type and 404s for misses and unreadable files", async () => {
    const readFile = vi.fn(async (p: string) => {
      if (p.endsWith("index.html")) return new TextEncoder().encode("<!doctype html>");
      throw new Error("ENOENT");
    });
    const handle = createAppProtocolHandler({ root, readFile });
    const ok = await handle({ url: RENDERER_URL });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/html");
    expect(await ok.text()).toBe("<!doctype html>");
    expect((await handle({ url: "app://renderer/missing.js" })).status).toBe(404);
    expect((await handle({ url: "file:///x" })).status).toBe(404);
    expect(readFile).toHaveBeenCalledTimes(2);
  });
});
