// @vitest-environment node
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const compiled = ts.transpileModule(readFileSync(new URL("../../src/main/preload.cts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function exposeFor(location: string, entry = "app-ui://bundle/index.html") {
  const exposed = vi.fn();
  const ipcRenderer = { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
  new Script(compiled).runInNewContext({ exports: {}, URL, Set,
    require: (name: string) => {
      if (name !== "electron") throw new Error("Unexpected preload dependency");
      return { ipcRenderer, contextBridge: { exposeInMainWorld: exposed } };
    },
    process: { argv: ["--video-manager-window-role=main", `--video-manager-entry-url=${encodeURIComponent(entry)}`] },
    window: { location: { href: location } }
  });
  return { exposed, ipcRenderer };
}

describe("preload renderer authority", () => {
  it.each([
    "app-ui://foreign/index.html", "app-ui://bundle:123/index.html", "app-ui://user@bundle/index.html",
    "app-ui://bundle/assets/index.html", "file:///bundle/index.html", "data:text/html,test",
    "other-ui://bundle/index.html"
  ])("does not expose a bridge to %s even when URL origins are null", (location) => {
    const result = exposeFor(location);
    expect(result.exposed).not.toHaveBeenCalled();
    expect(result.ipcRenderer.on).not.toHaveBeenCalled();
    expect(result.ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  it("exposes the application bridge at the exact packaged authority with role query/hash", () => {
    const { exposed } = exposeFor("app-ui://bundle/index.html?player=1#view");
    expect(exposed).toHaveBeenCalledOnce();
    expect(exposed.mock.calls[0]?.[0]).toBe("videoManager");
    expect(exposed.mock.calls[0]?.[1].getSettings).toBeTypeOf("function");
  });

  it("keeps the exact development origin and port boundary", () => {
    expect(exposeFor("http://localhost:5173/", "http://localhost:5173/").exposed).toHaveBeenCalledOnce();
    expect(exposeFor("http://localhost:5174/", "http://localhost:5173/").exposed).not.toHaveBeenCalled();
    expect(exposeFor("http://127.0.0.1:5173/", "http://localhost:5173/").exposed).not.toHaveBeenCalled();
  });
});
