// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkedDirectory, checkedFile, materializePinnedFiles, readPinnedZip, sha256, validateArchiveName, verifyPackage } from "../../scripts/native-player-toolchain.mjs";
import { compilerArguments, toolchain } from "../../scripts/build-native-player.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = mkdtempSync(path.join(os.tmpdir(), "movie-toolchain-test-")); roots.push(root); return root; };
function zip(names, attributes = 0, size = 0) {
  const locals = [], central = []; let offset = 0;
  for (const name of names) {
    const encoded = Buffer.from(name), local = Buffer.alloc(30), entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(encoded.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt32LE(size, 24); entry.writeUInt16LE(encoded.length, 28);
    entry.writeUInt32LE(attributes >>> 0, 38); entry.writeUInt32LE(offset, 42);
    locals.push(local, encoded); central.push(entry, encoded); offset += local.length + encoded.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe("pinned NativeHost toolchain trust boundaries", () => {
  it("rejects altered package bytes and non-official endpoints against immutable two-hash pins", () => {
    const bytes = Buffer.from("fixture");
    const pin = { ...toolchain.compiler, size: bytes.length, sha256: sha256(bytes),
      sha512: createHash("sha512").update(bytes).digest("base64") };
    expect(() => verifyPackage(bytes, pin)).not.toThrow();
    expect(() => verifyPackage(Buffer.from("changed"), pin)).toThrow(/pin/);
    expect(() => verifyPackage(bytes, { ...pin, sha512: "untrusted" })).toThrow(/pin/);
    expect(() => verifyPackage(bytes, { ...pin, url: pin.url.replace("api.nuget.org", "nuget.example.test") })).toThrow(/official/);
  });
  it.each(["../escape.dll", "/absolute.dll", "a/../../escape.dll", "C:/escape.dll", "a\\escape.dll", "a:stream.dll", "a//b", "a./b", "NUL.dll", "a?/b"])("rejects unsafe archive path %s before writing", (name) => {
    expect(() => validateArchiveName(name)).toThrow();
    expect(() => readPinnedZip(zip([name]), () => true)).toThrow();
  });
  it("rejects symlink metadata, case collisions, oversized expansion and truncated archives", () => {
    expect(() => readPinnedZip(zip(["linked.dll"], 0xa000 << 16), () => true)).toThrow(/metadata/);
    expect(() => readPinnedZip(zip(["A.dll", "a.dll"]), () => true)).toThrow(/Duplicate/);
    expect(() => readPinnedZip(zip(["large.dll"], 0, 33 * 1024 * 1024), () => true)).toThrow(/metadata/);
    expect(() => readPinnedZip(zip(["a.dll"]).subarray(0, -1), () => true)).toThrow();
    expect(readPinnedZip(zip(["a.dll"]), () => true).get("a.dll")).toEqual(Buffer.alloc(0));
  });
  it("refuses junction cache escape and unrelated output directories", () => {
    const root = temporary(), owned = path.join(root, "owned"), outside = path.join(root, "outside");
    mkdirSync(owned); mkdirSync(outside); symlinkSync(outside, path.join(owned, "link"), process.platform === "win32" ? "junction" : "dir");
    expect(() => checkedDirectory(owned, path.join(owned, "link", "child"))).toThrow(/Reparse/);
    expect(() => checkedDirectory(owned, outside)).toThrow(/escapes/);
  });
  it("allows only the explicitly configured project .tmp junction to use external D-drive storage", () => {
    const root = temporary(), owned = path.join(root, "owned"), storage = path.join(root, "external-storage");
    mkdirSync(owned); mkdirSync(storage);
    symlinkSync(storage, path.join(owned, ".tmp"), process.platform === "win32" ? "junction" : "dir");
    const previous = process.env.MOVIE_TEMP_ROOT;
    process.env.MOVIE_TEMP_ROOT = storage;
    try {
      const cache = path.join(owned, ".tmp", "native-player-toolchain");
      expect(checkedDirectory(owned, cache)).toBe(cache);
      const file = path.join(cache, "pinned.bin");
      writeFileSync(file, "pinned");
      expect(checkedDirectory(owned, path.dirname(file))).toBe(path.dirname(file));
      expect(checkedFile(owned, file)).toBe(file);
      expect(readFileSync(file, "utf8")).toBe("pinned");
      const unrelatedTarget = path.join(root, "unrelated-target"), unrelated = path.join(owned, "link");
      mkdirSync(unrelatedTarget);
      symlinkSync(unrelatedTarget, unrelated, process.platform === "win32" ? "junction" : "dir");
      expect(() => checkedDirectory(owned, path.join(unrelated, "child"))).toThrow(/Reparse/);
    } finally {
      if (previous === undefined) delete process.env.MOVIE_TEMP_ROOT;
      else process.env.MOVIE_TEMP_ROOT = previous;
    }
  });
  it("rejects tampered cached dependencies and extra adjacent code without overwriting them", () => {
    const root = temporary(), destination = path.join(root, "compiler"), pinned = new Map([["tasks/net472/csc.exe", Buffer.from("reviewed")]]);
    materializePinnedFiles(root, destination, pinned);
    const executable = path.join(destination, "tasks/net472/csc.exe");
    writeFileSync(executable, "tampered");
    expect(() => materializePinnedFiles(root, destination, pinned)).toThrow(/differ/);
    expect(readFileSync(executable, "utf8")).toBe("tampered");
    writeFileSync(executable, "reviewed"); writeFileSync(path.join(destination, "tasks/net472/injected.dll"), "extra");
    expect(() => materializePinnedFiles(root, destination, pinned)).toThrow(/Unexpected/);
  });
  it("forwards native key-up separately and does not misclassify its previous-key-state bit as auto-repeat", () => {
    const host = readFileSync(new URL("../../native/embedded-mpv/NativeHost.cs", import.meta.url), "utf8");
    expect(host).toContain("bool keyDown=msg==0x100||msg==0x104;");
    expect(host).toContain("bool keyUp=msg==0x101||msg==0x105;");
    expect(host).toContain("if(!keyDown&&!keyUp)return false;");
    expect(host).toContain("if(keyDown&&(lparam.ToInt64()&(1L<<30))!=0)return true;");
    expect(host).toContain("phase=keyUp?\"up\":\"down\"");
  });

  it("suppresses persistent focus outlines on the embedded playback surface without disabling control focus styles", () => {
    const css = readFileSync(new URL("../../src/renderer/styles.css", import.meta.url), "utf8");
    expect(css).toContain(".player-page .player-stage video:focus-visible,");
    expect(css).toContain(".player-page.uses-embedded-engine .player-stage:focus-visible,");
    expect(css).toContain(".player-page.uses-embedded-engine .player-embedded-surface:focus-visible {");
    expect(css).toContain("outline: none !important;");
    expect(css).toContain("box-shadow: none !important;");
    const focusRuleStart = css.indexOf("/* Keyboard shortcuts can focus either the HTML video element or the native playback host;");
    const focusRuleEnd = css.indexOf(".player-embedded-surface {", focusRuleStart);
    expect(focusRuleStart).toBeGreaterThanOrEqual(0);
    expect(focusRuleEnd).toBeGreaterThan(focusRuleStart);
    expect(css.slice(focusRuleStart, focusRuleEnd)).not.toContain("button");
  });

  it("pins C#5, x64, deterministic output, explicit refs, encoding and mapped paths without machine response defaults", () => {
    const root = temporary(), source = path.join(root, "source with spaces", "NativeHost.cs"), stage = path.join(root, "stage");
    const references = [path.join(root, "mscorlib.dll"), path.join(root, "System.dll")];
    const args = compilerArguments(source, path.join(stage, "NativeHost.exe"), references, stage);
    expect(args).toEqual(expect.arrayContaining(["/deterministic+", "/noconfig", "/nostdlib+", "/langversion:5", "/platform:x64", "/optimize+", "/debug-", "/codepage:65001"]));
    expect(args.filter(arg => arg.startsWith("/reference:"))).toEqual(references.map(reference => `/reference:${reference}`));
    expect(args.some(arg => arg.startsWith("/pathmap:") && arg.includes("=/_/src"))).toBe(true);
    expect(args.at(-1)).toBe(source);
  });
});
