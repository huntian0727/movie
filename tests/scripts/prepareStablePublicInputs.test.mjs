import { describe, expect, it } from "vitest";
import { assertStablePublicInputContext } from "../../scripts/prepare-stable-public-inputs.mjs";

const validApproval = {
  approved: true,
  unsignedAcknowledged: true,
  scope: "stable-portable-only",
  version: "0.1.17",
};
const validEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_REF: "refs/tags/v0.1.17",
  MOVIE_RELEASE_CLASS: "unsigned-public-release",
  GH_TOKEN: "test-token",
};

describe("stable public input release binding", () => {
  it("accepts the exact package version and owner-approved stable scope", () => {
    expect(() => assertStablePublicInputContext(validEnv, "0.1.17", validApproval)).not.toThrow();
  });
  it("rejects the previous hard-coded tag and mismatched package/approval versions", () => {
    expect(() => assertStablePublicInputContext({ ...validEnv, GITHUB_REF: "refs/tags/v0.1.16" }, "0.1.17", validApproval)).toThrow();
    expect(() => assertStablePublicInputContext(validEnv, "0.1.17", { ...validApproval, version: "0.1.16" })).toThrow();
  });
  it("rejects non-tag builds, missing tokens, and unapproved scope", () => {
    expect(() => assertStablePublicInputContext({ ...validEnv, GITHUB_REF: "refs/heads/main" }, "0.1.17", validApproval)).toThrow();
    expect(() => assertStablePublicInputContext({ ...validEnv, GH_TOKEN: "" }, "0.1.17", validApproval)).toThrow();
    expect(() => assertStablePublicInputContext(validEnv, "0.1.17", { ...validApproval, approved: false })).toThrow();
  });
});
