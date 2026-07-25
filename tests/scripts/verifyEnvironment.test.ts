import { describe, expect, it } from "vitest";
import {
  formatEnvironmentError,
  inspectEnvironment,
  parseNpmVersion,
  REQUIRED_NODE_VERSION,
  REQUIRED_NPM_VERSION
} from "../../scripts/verify-environment.mjs";

describe("development environment verification", () => {
  it("accepts only the pinned Node and npm versions", () => {
    expect(inspectEnvironment({ nodeVersion: REQUIRED_NODE_VERSION, npmVersion: REQUIRED_NPM_VERSION })).toMatchObject({
      ok: true,
      problems: []
    });
    expect(inspectEnvironment({ nodeVersion: "24.14.0", npmVersion: "11.9.0" })).toMatchObject({ ok: false });
  });

  it("extracts npm from the package-manager user agent", () => {
    expect(parseNpmVersion("npm/10.9.8 node/v22.23.1 win32 x64 workspaces/false")).toBe("10.9.8");
    expect(parseNpmVersion("unknown-client")).toBeUndefined();
  });

  it("provides actionable recovery without suggesting user-data deletion", () => {
    const message = formatEnvironmentError(inspectEnvironment({ nodeVersion: "24.14.0", npmVersion: "11.9.0" }));
    expect(message).toContain("Node 22.23.1");
    expect(message).toContain("npm@10.9.8");
    expect(message).toContain("Do not delete library.sqlite");
  });
});
