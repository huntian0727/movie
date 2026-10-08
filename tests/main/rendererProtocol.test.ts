// @vitest-environment node
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createRendererProtocolHandler, getRendererResourcePath } from "../../src/main/rendererProtocol";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "movie-app-protocol-")); roots.push(root);
  const bundle = path.join(root, "bundle"); await mkdir(path.join(bundle, "assets"), { recursive: true });
  await writeFile(path.join(bundle, "index.html"), "<html>synthetic</html>");
  await writeFile(path.join(bundle, "assets", "bundle-abc.js"), "window.synthetic=true;");
  await writeFile(path.join(root, "private.js"), "window.private=true;");
  return { root, bundle, handle: createRendererProtocolHandler(bundle) };
}
describe("restricted app-ui build protocol", () => {
  it.each(["app-ui://bundle/index.html", "app-ui://bundle/index.html?player=1#state", "app-ui://bundle/assets/bundle-abc.js"])("accepts build resource %s", input => {
    expect(getRendererResourcePath(input)).toMatch(/^(index\.html|assets\/bundle-abc\.js)$/);
  });
  it.each([
    "app-ui://evil/index.html", "app-ui://bundle:123/index.html", "app-ui://user@bundle/index.html", "file:///bundle/index.html",
    "app-ui://bundle/../index.html", "app-ui://bundle/assets/%2e%2e/index.html", "app-ui://bundle/assets/%252e%252e/index.html",
    "app-ui://bundle/assets/%2fprivate.js", "app-ui://bundle/assets/%5cprivate.js", "app-ui://bundle/assets/..\\private.js",
    "app-ui://bundle/assets/a.js:stream", "app-ui://bundle/assets/a.js%00", "app-ui://bundle/assets/%zz.js",
    "app-ui://bundle/private.js", "app-ui://bundle/assets/a.exe", "app-ui://bundle/assets//x.js"
  ])("rejects untrusted resource %s", input => expect(() => getRendererResourcePath(input)).toThrow("Invalid application resource"));
  it("serves only assets with restrictive MIME/CSP headers and rejects non-read methods", async () => {
    const { handle } = await fixture();
    const response = await handle(new Request("app-ui://bundle/index.html"));
    expect(response.status).toBe(200); expect(await response.text()).toBe("<html>synthetic</html>");
    expect(response.headers.get("content-security-policy")).toContain("frame-src 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await handle(new Request("app-ui://bundle/assets/bundle-abc.js", { method: "HEAD" }))).status).toBe(200);
    expect((await handle(new Request("app-ui://bundle/index.html", { method: "POST" }))).status).toBe(404);
    expect((await handle(new Request("app-ui://bundle/private.js"))).status).toBe(404);
  });
  it("rejects directory junctions and file symlinks escaping the build tree", async () => {
    const { root, bundle, handle } = await fixture();
    await mkdir(path.join(root, "external")); await writeFile(path.join(root, "external", "outside.js"), "private");
    // Junction creation does not require Windows developer mode or administrator privileges.
    await symlink(path.join(root, "external"), path.join(bundle, "assets", "linked"), process.platform === "win32" ? "junction" : "dir");
    const response = await handle(new Request("app-ui://bundle/assets/linked/outside.js"));
    expect(response.status).toBe(404); expect(await response.text()).not.toContain(root);
  });
  it("returns fixed errors without exposing host filesystem paths", async () => {
    const { root, handle } = await fixture();
    const response = await handle(new Request("app-ui://bundle/assets/missing.js"));
    expect(response.status).toBe(404); expect(await response.text()).toBe("Application resource unavailable");
    expect(await (await handle(new Request("app-ui://bundle/assets/a.exe"))).text()).not.toContain(root);
  });
});
