// @vitest-environment node

import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectMoveTarget } from "../../src/main/files/fileOperations.js";
import { buildFullContentHash } from "../../src/main/media/contentFingerprint.js";
import { readMetadata } from "../../src/main/media/metadataService.js";
import { createSyntheticLibrary } from "../fixtures/syntheticLibrary.js";

let tempDirectory: string | undefined;

afterEach(() => {
  if (tempDirectory) {
    rmSync(tempDirectory, { recursive: true, force: true });
    tempDirectory = undefined;
  }
});

describe("synthetic Windows release library", () => {
  it("contains safe duplicate, conflict, and real media fixtures", async () => {
    tempDirectory = mkdtempSync(path.join(tmpdir(), "video-manager-release-fixture-"));
    const fixture = await createSyntheticLibrary(tempDirectory);

    expect(statSync(fixture.identical[0]).size).toBe(statSync(fixture.identical[1]).size);
    expect(await buildFullContentHash(fixture.identical[0])).toBe(await buildFullContentHash(fixture.identical[1]));

    expect(statSync(fixture.sameSizeDifferentContent[0]).size).toBe(statSync(fixture.sameSizeDifferentContent[1]).size);
    expect(await buildFullContentHash(fixture.sameSizeDifferentContent[0])).not.toBe(
      await buildFullContentHash(fixture.sameSizeDifferentContent[1])
    );

    await expect(inspectMoveTarget(fixture.conflictSource, path.dirname(fixture.conflictTarget))).resolves.toMatchObject({
      plan: "rename",
      targetPath: path.join(path.dirname(fixture.conflictTarget), "conflict1.mp4")
    });

    const metadata = await readMetadata(fixture.tinyVideo);
    expect(metadata).toMatchObject({ width: 32, height: 24 });
    expect(metadata.durationMs).toBeGreaterThan(0);
    expect(metadata.format).toContain("mp4");
  }, 30_000);
});
