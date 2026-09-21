// @vitest-environment node

import { describe, expect, it } from "vitest";
import { identifyKnownNonVideoContent } from "../../src/main/media/fileSignature";

describe("file signature inspection", () => {
  it.each([
    [Buffer.from([0x50, 0x4b, 0x03, 0x04]), "zip"],
    [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]), "rar"],
    [Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), "7z"],
    [Buffer.from("%PDF-1.7", "ascii"), "pdf"],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "png"]
  ])("recognizes known non-video content", (bytes, kind) => {
    expect(identifyKnownNonVideoContent(bytes)).toMatchObject({ kind });
  });

  it("does not classify an MP4 header as known non-video content", () => {
    expect(identifyKnownNonVideoContent(Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBeNull();
  });
});
