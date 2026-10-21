import { describe, expect, it } from "vitest";
import {
  assertDeliveredVersionAdvanced, bumpDisplayVersion, formatDisplayVersion,
  MAX_MINOR, readDisplayVersion, validateDisplayVersion
} from "../../scripts/display-version.mjs";

describe("two-segment visible product version", () => {
  it("has one canonical source currently at v1.1", async () => {
    expect(await readDisplayVersion()).toEqual({ major: 1, minor: 1 });
    expect(formatDisplayVersion(await readDisplayVersion())).toBe("1.1");
  });
  it("bumps small updates only in second component", () => {
    expect(bumpDisplayVersion({ major: 1, minor: 1 }, "minor")).toEqual({ major: 1, minor: 2 });
    expect(bumpDisplayVersion({ major: 2, minor: 998 }, "minor")).toEqual({ major: 2, minor: 999 });
    expect(formatDisplayVersion({ major: 1, minor: 999 })).toBe("1.999");
    expect(MAX_MINOR).toBe(999);
  });
  it("bumps big updates in first component and resets minor to zero", () => {
    expect(bumpDisplayVersion({ major: 1, minor: 987 }, "major")).toEqual({ major: 2, minor: 0 });
    expect(formatDisplayVersion({ major: 2, minor: 0 })).toBe("2.0");
  });
  it("rejects invalid versions or overflowing minor update", () => {
    expect(() => bumpDisplayVersion({ major: 1, minor: 999 }, "minor")).toThrow(/999/);
    expect(() => validateDisplayVersion({ major: 1.5, minor: 3 })).toThrow();
    expect(() => validateDisplayVersion({ major: 1, minor: 1000 })).toThrow();
    expect(() => validateDisplayVersion({ major: 0, minor: 1 })).toThrow();
    expect(() => bumpDisplayVersion({ major: 1, minor: 1 }, "patch")).toThrow();
  });
  it("refuses a new commit if previous local desktop already has the same display version", () => {
    expect(() => assertDeliveredVersionAdvanced(
      { commit: "old", displayVersion: "1.1" }, { major: 1, minor: 1 }, "new"
    )).toThrow(/version/);
    expect(() => assertDeliveredVersionAdvanced(
      { commit: "old", displayVersion: "1.1" }, { major: 1, minor: 2 }, "new"
    )).not.toThrow();
    expect(() => assertDeliveredVersionAdvanced(
      { commit: "old", displayVersion: "1.1" }, { major: 2, minor: 0 }, "new"
    )).not.toThrow();
  });
  it("permits reproducible repacks of the same commit and one-time migration from old packages", () => {
    expect(() => assertDeliveredVersionAdvanced(
      { commit: "same", displayVersion: "1.1" }, { major: 1, minor: 1 }, "same"
    )).not.toThrow();
    expect(() => assertDeliveredVersionAdvanced(
      { commit: "old", version: "0.1.16" }, { major: 1, minor: 1 }, "new"
    )).not.toThrow();
    expect(() => assertDeliveredVersionAdvanced(null, { major: 1, minor: 1 }, "new")).not.toThrow();
  });
  it("refuses downgrades and corrupted package marker versions", () => {
    expect(() => assertDeliveredVersionAdvanced(
      { commit: "old", displayVersion: "2.0" }, { major: 1, minor: 999 }, "new"
    )).toThrow(/must not decrease/);
    expect(() => assertDeliveredVersionAdvanced(
      { commit: "old", displayVersion: "1.1000" }, { major: 2, minor: 0 }, "new"
    )).toThrow(/malformed/);
  });
});
