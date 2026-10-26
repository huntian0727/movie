import { describe, expect, it } from "vitest";
import type { DuplicateDirectoryOption } from "../../src/shared/videoTypes";
import { filterAndSortDirectoryOptions } from "../../src/renderer/components/duplicateDirectoryOptions";

const GIB = 1024 ** 3;

function option(path: string, groupCount: number, estimatedCleanupFileCount: number, estimatedReclaimableBytes: number): DuplicateDirectoryOption {
  return { path, groupCount, estimatedCleanupFileCount, estimatedReclaimableBytes };
}

const options = [
  option("D:\\Media\\Folder 10", 2, 4, 20 * GIB),
  option("D:\\Media\\Folder 2", 2, 4, 20 * GIB),
  option("D:\\Media\\Small", 1, 1, 2 * GIB),
  option("D:\\Media\\Many files", 1, 100, 8 * GIB),
  option("D:\\Media\\Many groups", 10, 3, 7 * GIB)
];

describe("filterAndSortDirectoryOptions", () => {
  it("ranks by reclaimable space by default and uses numeric path order for ties", () => {
    expect(filterAndSortDirectoryOptions(options, "all", "space").map((item) => item.path)).toEqual([
      "D:\\Media\\Folder 2",
      "D:\\Media\\Folder 10",
      "D:\\Media\\Many files",
      "D:\\Media\\Many groups",
      "D:\\Media\\Small"
    ]);
  });

  it("ranks by cleanup file count, then space, groups and path", () => {
    expect(filterAndSortDirectoryOptions(options, "all", "files").map((item) => item.path)).toEqual([
      "D:\\Media\\Many files",
      "D:\\Media\\Folder 2",
      "D:\\Media\\Folder 10",
      "D:\\Media\\Many groups",
      "D:\\Media\\Small"
    ]);
  });

  it("ranks by group count, then space, files and path", () => {
    expect(filterAndSortDirectoryOptions(options, "all", "groups").map((item) => item.path)).toEqual([
      "D:\\Media\\Many groups",
      "D:\\Media\\Folder 2",
      "D:\\Media\\Folder 10",
      "D:\\Media\\Many files",
      "D:\\Media\\Small"
    ]);
  });

  it("sorts paths in locale-aware numeric order", () => {
    const paths = [option("Folder 10", 1, 1, 1), option("Folder 2", 1, 1, 1), option("Folder 1", 1, 1, 1)];
    expect(filterAndSortDirectoryOptions(paths, "all", "path").map((item) => item.path)).toEqual(["Folder 1", "Folder 2", "Folder 10"]);
  });

  it("applies file-count presets inclusively at the documented thresholds", () => {
    const counts = [option("nine", 1, 9, 1), option("ten", 1, 10, 1), option("ninety-nine", 1, 99, 1), option("hundred", 1, 100, 1)];
    expect(filterAndSortDirectoryOptions(counts, "files-10", "path").map((item) => item.path)).toEqual(["hundred", "ninety-nine", "ten"]);
    expect(filterAndSortDirectoryOptions(counts, "files-100", "path").map((item) => item.path)).toEqual(["hundred"]);
  });

  it("applies reclaimable-space presets inclusively at 10 GiB, 100 GiB and 1 TiB", () => {
    const sizes = [
      option("under-10", 1, 1, 10 * GIB - 1),
      option("ten", 1, 1, 10 * GIB),
      option("under-100", 1, 1, 100 * GIB - 1),
      option("hundred", 1, 1, 100 * GIB),
      option("under-1tb", 1, 1, 1024 * GIB - 1),
      option("one-tb", 1, 1, 1024 * GIB)
    ];
    expect(filterAndSortDirectoryOptions(sizes, "space-10gb", "path").map((item) => item.path)).toEqual(["hundred", "one-tb", "ten", "under-1tb", "under-100"]);
    expect(filterAndSortDirectoryOptions(sizes, "space-100gb", "path").map((item) => item.path)).toEqual(["hundred", "one-tb", "under-1tb"]);
    expect(filterAndSortDirectoryOptions(sizes, "space-1tb", "path").map((item) => item.path)).toEqual(["one-tb"]);
  });

  it("does not mutate the source list when filtering and sorting", () => {
    const source = [...options];
    const originalOrder = source.map((item) => item.path);
    const result = filterAndSortDirectoryOptions(source, "files-10", "space");
    expect(result).not.toBe(source);
    expect(source.map((item) => item.path)).toEqual(originalOrder);
  });
});
