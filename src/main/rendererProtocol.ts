import type { Protocol } from "electron";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { PRODUCTION_CSP } from "./security.js";

export const RENDERER_SCHEME = "app-ui";
export const RENDERER_ORIGIN = "app-ui://bundle";
export const RENDERER_ENTRY_URL = "app-ui://bundle/index.html";
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const assetTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".wasm": "application/wasm"
};

/** This protocol serves only immutable build assets, never user paths or database IDs. */
export function createRendererProtocolHandler(rendererRoot: string): (request: Request) => Promise<Response> {
  const unavailable = () => new Response("Application resource unavailable", { status: 404 });
  return async (request) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") return unavailable();
      const resource = getRendererResourcePath(request.url);
      if ((await lstat(rendererRoot)).isSymbolicLink()) return unavailable();
      const root = await realpath(rendererRoot);
      let target = root;
      for (const part of resource.split("/")) {
        target = path.join(target, part);
        if ((await lstat(target)).isSymbolicLink()) return unavailable();
      }
      const actual = await realpath(target);
      const relative = path.relative(root, actual);
      if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return unavailable();
      const info = await lstat(actual);
      if (!info.isFile() || info.size > MAX_ASSET_BYTES) return unavailable();
      const type = assetTypes[path.extname(resource).toLowerCase()];
      if (!type) return unavailable();
      const data = request.method === "HEAD" ? null : new Uint8Array(await readFile(actual));
      return new Response(data, { headers: {
        "Content-Type": type, "Content-Length": String(info.size),
        "Content-Security-Policy": PRODUCTION_CSP, "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "no-store"
      } });
    } catch { return unavailable(); }
  };
}

/** Validate before URL normalization, and decode exactly once. Encoded separators/ADS are never paths. */
export function getRendererResourcePath(input: string): string {
  const raw = /^app-ui:\/\/bundle(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/.exec(input);
  if (!raw) throw new Error("Invalid application resource");
  if (/%(?:2f|5c)/i.test(raw[1] ?? "")) throw new Error("Invalid application resource");
  let pathname: string;
  try { pathname = decodeURIComponent(raw[1] ?? "/"); }
  catch { throw new Error("Invalid application resource"); }
  if (/[\\\x00-\x1f:%]/.test(pathname) || pathname.split("/").some(part => part === "." || part === "..")) {
    throw new Error("Invalid application resource");
  }
  const url = new URL(input);
  if (url.protocol !== `${RENDERER_SCHEME}:` || url.hostname !== "bundle" || url.port || url.username || url.password) {
    throw new Error("Invalid application resource");
  }
  const resource = pathname.slice(1);
  if (resource !== "index.html" && !/^assets\/[A-Za-z0-9_./-]+$/.test(resource)) throw new Error("Invalid application resource");
  if (resource.includes("//") || resource.endsWith("/") || !assetTypes[path.extname(resource).toLowerCase()]) throw new Error("Invalid application resource");
  return resource;
}

export function registerRendererProtocol(target: Pick<Protocol, "handle">, rendererRoot: string): void {
  target.handle(RENDERER_SCHEME, createRendererProtocolHandler(rendererRoot));
}
