import { describe, expect, it } from "vitest";
import { legacyUserDataPath } from "../../src/main/legacyUserDataPath";

describe("legacy user data path", () => {
  it("keeps the original data directory after the product rename", () => {
    expect(legacyUserDataPath("C:\\Users\\test\\AppData\\Roaming"))
      .toBe("C:\\Users\\test\\AppData\\Roaming\\local-video-manager");
  });
});
