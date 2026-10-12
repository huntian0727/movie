// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("source community workflow delivery boundaries", () => {
  it("is manual, preserves formal approval gates, and uploads only metadata or encrypted ZIP", async () => {
    const workflow = await readFile(".github/workflows/source-community-build.yml", "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\n\s+(push|release|pull_request):/);
    expect(workflow).toContain("contents: read");
    expect(workflow.match(/contents: write/g)).toHaveLength(1);
    expect(workflow).not.toMatch(/gh release|softprops\/action-gh-release|BEGIN.*PRIVATE KEY/);
    for (const name of ["RELEASE_LICENSE_APPROVED", "RELEASE_BINARY_COMPLIANCE_APPROVED", "RELEASE_MANUAL_QA_APPROVED"]) {
      expect(workflow).toContain(`${name}: \u0024{{ vars.${name} }}`);
    }
    expect(workflow).toContain("createBuildFlavor");
    expect(workflow).toContain("prepare-source-release-inputs.mjs");
    expect(workflow).toContain("npm run test:release-gate");
    expect(workflow).toContain("npm run verify:zip");
    expect(workflow).toContain("npm run release:metadata -- --portable");
    expect(workflow).toContain('seal $qa.archive "$directory/private-community.zip.enc"');
    expect(workflow).not.toMatch(/path:.*\.zip\s*$/m);
    expect(workflow).not.toContain("candidate-private.pem");
    const artifactSection = workflow.slice(workflow.indexOf("- name: Upload metadata only"));
    expect(artifactSection).not.toMatch(/win-unpacked|\*Setup|\.zip\s*$/m);
  });
  it("uses the same pinned inputs in its read-only transport probe", async () => {
    const probe = await readFile(".github/workflows/native-source-input-check.yml", "utf8");
    expect(probe).toContain("contents: read"); expect(probe).toContain("prepare-source-release-inputs.mjs");
    expect(probe.match(/contents: write/g)).toHaveLength(1);
    expect(probe).toContain("path: .tmp/native-source-inputs/transport-verification.json");
    expect(probe).not.toMatch(/npm ci|gh release|candidate-private|\.zip\s*$/m);
  });
});
