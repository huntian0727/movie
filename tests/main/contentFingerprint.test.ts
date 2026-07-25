// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildContentFingerprint, buildFullContentHash, captureFileVersion, verifyIdenticalFiles } from "../../src/main/media/contentFingerprint";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("buildContentFingerprint", () => {
  it("returns the same fingerprint for identical content", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "video-fingerprint-"));
    const firstPath = path.join(tempDir, "a.bin");
    const secondPath = path.join(tempDir, "b.bin");
    const content = Buffer.from("same-content".repeat(20_000));

    writeFileSync(firstPath, content);
    writeFileSync(secondPath, content);

    const first = await buildContentFingerprint(firstPath, content.byteLength);
    const second = await buildContentFingerprint(secondPath, content.byteLength);

    expect(first).toBe(second);
  });

  it("changes when file content changes", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "video-fingerprint-"));
    const firstPath = path.join(tempDir, "a.bin");
    const secondPath = path.join(tempDir, "b.bin");
    const firstContent = Buffer.from("same-content".repeat(20_000));
    const secondContent = Buffer.from(`same-content${"x".repeat(32)}`.repeat(20_000));

    writeFileSync(firstPath, firstContent);
    writeFileSync(secondPath, secondContent);

    const first = await buildContentFingerprint(firstPath, firstContent.byteLength);
    const second = await buildContentFingerprint(secondPath, secondContent.byteLength);

    expect(first).not.toBe(second);
  });

  it("detects a collision in the sampled fingerprint with a full streaming hash", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "video-fingerprint-"));
    const firstPath = path.join(tempDir, "a.bin");
    const secondPath = path.join(tempDir, "b.bin");
    const content = Buffer.alloc(512 * 1024, 1);
    const changed = Buffer.from(content);
    changed[96 * 1024] = 2;

    writeFileSync(firstPath, content);
    writeFileSync(secondPath, changed);

    expect(await buildContentFingerprint(firstPath, content.byteLength)).toBe(
      await buildContentFingerprint(secondPath, changed.byteLength)
    );
    expect(await buildFullContentHash(firstPath)).not.toBe(await buildFullContentHash(secondPath));
    await expect(verifyIdenticalFiles([firstPath, secondPath])).rejects.toThrow(/内容不一致/);
  });

  it("rejects a file whose version no longer matches the verified snapshot", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "video-fingerprint-"));
    const filePath = path.join(tempDir, "a.bin");
    writeFileSync(filePath, "before");
    const version = await captureFileVersion(filePath);
    writeFileSync(filePath, "after-change");

    await expect(verifyIdenticalFiles([filePath], new Map([[filePath, version]]))).rejects.toThrow(/文件已变化/);
  });
});
