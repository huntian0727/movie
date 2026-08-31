import { describe, expect, it } from "vitest";
import { getCoverUrl } from "../../src/shared/previewIdentity";
import type { VideoRecord } from "../../src/shared/videoTypes";

const video = { id: "video", sizeBytes: 1000, modifiedAt: "2026-09-01T00:00:00Z", durationMs: null } as VideoRecord;

describe("stable cover identity", () => {
  it("ignores database timestamps, favorites and preview readiness", () => {
    const url = getCoverUrl(video, 5);
    for (let tick = 0; tick < 20; tick++) {
      expect(getCoverUrl({ ...video, updatedAt: String(tick), thumbnailStatus: "ready", isFavorite: Boolean(tick % 2) }, 5)).toBe(url);
    }
  });

  it("changes only for a different video, file version or effective frame", () => {
    const url = getCoverUrl(video, 5);
    expect(getCoverUrl({ ...video, sizeBytes: 2000 }, 5)).not.toBe(url);
    expect(getCoverUrl({ ...video, modifiedAt: "2026-09-02" }, 5)).not.toBe(url);
    expect(getCoverUrl({ ...video, id: "other" }, 5)).not.toBe(url);
    expect(getCoverUrl(video, 10)).not.toBe(url);
    expect(getCoverUrl({ ...video, durationMs: 90_000 }, 5)).toBe(url);
    expect(getCoverUrl({ ...video, durationMs: 2000 }, 5)).not.toBe(url);
  });
});
