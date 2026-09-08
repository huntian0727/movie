// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database.js";
import { VideoRepository } from "../../src/main/db/videoRepository.js";
import { queryVideoData, iterateVideoData, csvCell } from "../../src/main/videoData/videoDataQueries.js";
import { videoDataQuerySchema } from "../../src/shared/videoDataTable.js";
let directory: string, db: DatabaseConnection, repo: VideoRepository, source: string;
beforeEach(() => { directory = mkdtempSync(path.join(tmpdir(), "video-data-test-")); db = createDatabase(path.join(directory, "library.sqlite")); repo = new VideoRepository(db); source = repo.addSourceFolder("F:\\Videos", true).id; });
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
function add(name: string, folder = "F:\\Videos", size = 100, duration: number | null = 5000) {
  return repo.upsertVideo({ sourceFolderId: source, path: `${folder}\\${name}`, directory: folder, filename: name, basename: name, extension: ".mp4", sizeBytes: size, durationMs: duration, width: null, height: null, format: "mp4", modifiedAt: "2026-09-08T00:00:00.000Z" });
}
describe("video data table queries", () => {
  it("paginates with stable ordering and includes missing records", () => {
    for (let n = 0; n < 110; n++) add(`${String(n).padStart(3, "0")}.mp4`);
    db.prepare("UPDATE videos SET is_missing=1 WHERE filename='000.mp4'").run();
    const query = videoDataQuerySchema.parse({ pageSize: 50, sort: "filename", direction: "asc" });
    const first = queryVideoData(db, query), second = queryVideoData(db, { ...query, page: 2 });
    expect(first.totalCount).toBe(110); expect(first.totalBytes).toBe(11000);
    expect(first.items[0].isMissing).toBe(true); expect(second.items[0].filename).toBe("050.mp4");
    expect(queryVideoData(db, { ...query, page: 99 }).page).toBe(3);
  });
  it("matches literal path keywords and directory boundaries including a drive root", () => {
    add("a.mp4", "F:\\Videos\\100%_!"); add("b.mp4", "F:\\Videos2"); add("root.mp4", "F:\\");
    expect(queryVideoData(db, videoDataQuerySchema.parse({ search: "100%_!" })).totalCount).toBe(1);
    expect(queryVideoData(db, videoDataQuerySchema.parse({ directory: "f:/videos/" })).totalCount).toBe(1);
    expect(queryVideoData(db, videoDataQuerySchema.parse({ directory: "F:\\" })).totalCount).toBe(3);
  });
  it("combines numeric, date and status filters without treating unknown duration as zero", () => {
    add("yes.mp4", undefined, 200, 10000); add("unknown.mp4", undefined, 200, null); add("small.mp4", undefined, 100, 10000);
    db.prepare("UPDATE videos SET imported_at='2026-09-08T12:00:00.000Z',metadata_status='ready'").run();
    const query = videoDataQuerySchema.parse({ minSize: 150, minDuration: 0, status: "normal", addedFrom: "2026-09-08T00:00:00.000Z", addedTo: "2026-09-09T00:00:00.000Z" });
    expect(queryVideoData(db, query).items.map(v => v.filename)).toEqual(["yes.mp4"]);
  });
  it("exports all matching records except exclusions or only explicit selected IDs", () => {
    const a = add("a.mp4"), b = add("b.mp4"); add("c.mp4");
    const query = videoDataQuerySchema.parse({});
    expect([...iterateVideoData(db, query, { all: true, ids: [], excludedIds: [b.id] })]).toHaveLength(2);
    expect([...iterateVideoData(db, query, { all: false, ids: [a.id], excludedIds: [] })].map(v => v.id)).toEqual([a.id]);
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("a,\nb")).toBe('"a,\nb"');
  });
  it("rejects invalid query sort and unbounded page sizes", () => {
    expect(() => videoDataQuerySchema.parse({ sort: "DROP TABLE videos" })).toThrow();
    expect(() => videoDataQuerySchema.parse({ pageSize: 100000 })).toThrow();
  });
});
