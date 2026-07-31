// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  isManagedPathWithin,
  managedPathEquals,
  normalizeManagedPath
} from "../../src/main/files/pathNormalization";

describe("managed Windows path normalization", () => {
  it("uses one identity for case, slash, and trailing-separator variants", () => {
    const variants = [
      "D:\\Movies\\Series",
      "d:/movies/series/",
      "D:\\MOVIES\\SERIES\\\\"
    ];
    expect(new Set(variants.map(normalizeManagedPath))).toEqual(new Set(["d:\\movies\\series"]));
    expect(managedPathEquals(variants[0], variants[1])).toBe(true);
  });

  it("does not confuse a sibling path that merely shares a prefix", () => {
    expect(isManagedPathWithin("D:\\Movies\\Series\\a.mp4", "D:\\Movies")).toBe(true);
    expect(isManagedPathWithin("D:\\Movies-Backup\\a.mp4", "D:\\Movies")).toBe(false);
  });

  it("normalizes UNC paths without losing the server/share boundary", () => {
    expect(normalizeManagedPath("\\\\NAS\\Media\\Series\\")).toBe("\\\\nas\\media\\series");
    expect(isManagedPathWithin("\\\\NAS\\Media\\Series\\a.mp4", "\\\\nas\\media")).toBe(true);
  });
});
