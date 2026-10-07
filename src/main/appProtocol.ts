import { extname, join, relative, resolve, sep } from "node:path";

/**
 * The renderer is served from `app://renderer/...` instead of `file://`. That keeps the
 * GrantFileProtocolExtraPrivileges fuse off (file:// pages could not even load ES-module
 * scripts without it) and gives the page a real, non-null origin for CSP and IPC checks.
 */
export const APP_SCHEME = "app";
export const APP_HOST = "renderer";
export const RENDERER_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;
export const RENDERER_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
};

export function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** `app://renderer/<path>` → absolute file under `root`, or null for anything else (other hosts, traversal). */
export function resolveAppUrl(url: string, root: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST) return null;
  const pathname = decodeURIComponent(parsed.pathname === "/" ? "/index.html" : parsed.pathname);
  const file = resolve(root, `.${pathname}`);
  const rel = relative(root, file);
  if (rel.startsWith("..") || rel.includes(`..${sep}`) || resolve(root, rel) !== file) return null;
  return join(root, rel);
}

export type AppProtocolDeps = { root: string; readFile: (path: string) => Promise<Uint8Array> };

/** The `protocol.handle` callback: files from the renderer build, 404 for everything else. */
export function createAppProtocolHandler({
  root,
  readFile,
}: AppProtocolDeps): (request: { url: string }) => Promise<Response> {
  return async (request) => {
    const file = resolveAppUrl(request.url, root);
    if (!file) return new Response("Not found", { status: 404 });
    try {
      const body = await readFile(file);
      return new Response(body, { status: 200, headers: { "content-type": mimeFor(file) } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  };
}
