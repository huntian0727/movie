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
    expect(workflow).toContain("verify-source-build-ci.mjs");
    expect(workflow.indexOf("verify-source-build-ci.mjs")).toBeLessThan(workflow.indexOf("prepare-source-release-inputs.mjs"));
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain(".tmp/source-release-ci/exact-commit-ci.json");
    const mainCi = await readFile(".github/workflows/windows-ci.yml", "utf8");
    expect(mainCi).toContain("npm run test:release-gate");
    expect(mainCi).toContain("TEMP: \u0024{{ runner.temp }}");
    expect(mainCi).toContain("TMP: \u0024{{ runner.temp }}");
    expect(workflow).toContain("npm run test:electron-smoke");
    expect(workflow).toContain("npm run test:renderer-security-smoke");
    expect(workflow).not.toMatch(/--testTimeout|--retry|--exclude|--passWithNoTests/);
    expect(workflow).toContain("npm run verify:zip");
    expect(workflow).toContain("npm run release:metadata -- --portable");
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    expect(pkg.scripts["release:metadata"]).toBe("node scripts/with-movie-storage.mjs node scripts/write-release-metadata.mjs");
    const builder = await readFile("scripts/run-electron-builder.mjs", "utf8");
    expect(builder).toContain('args.push("--publish", "never")');
    expect(builder.indexOf('args.push("--publish", "never")')).toBeLessThan(builder.indexOf('spawn(process.execPath'));
    expect(workflow).toContain('seal $qa.archive "$directory/private-community.zip.enc"');
    expect(workflow).not.toMatch(/path:.*\.zip\s*$/m);
    expect(workflow).not.toContain("candidate-private.pem");
    const artifactSection = workflow.slice(workflow.indexOf("- name: Upload metadata only"));
    expect(artifactSection).not.toMatch(/win-unpacked|\*Setup|\.zip\s*$/m);
  });
  it("pins durable FFmpeg only for isolated Windows CI tests without authorizing source-built distribution", async () => {
    const ci = await readFile(".github/workflows/windows-ci.yml", "utf8");
    const nodeTests = ci.split("  node-tests:")[1]?.split("  electron-smoke:")[0];
    const unsignedQa = ci.split("  unsigned-installation-qa:")[1];
    expect(nodeTests).toBeDefined();
    expect(unsignedQa).toBeDefined();
    expect(nodeTests).toContain("MOVIE_MEDIA_VARIANT: lite-candidate");
    expect(nodeTests).toContain("Stage pinned Lite QA tools for synthetic-media tests");
    expect(nodeTests).toContain(".tmp/native-media-lite-tools/*");
    expect(nodeTests).toContain("native-bin/media-tools/ffmpeg.exe");
    expect(nodeTests).toContain("npm run test:release-gate");
    expect(unsignedQa).toContain("MOVIE_RELEASE_CLASS: unsigned-test-build");
    expect(unsignedQa).toContain("MOVIE_MEDIA_VARIANT: lite-candidate");
    for (const gate of ["npm run verify:artifact", "npm run test:packaged-smoke", "npm run test:installer-smoke"]) {
      expect(unsignedQa).toContain(gate);
    }
    const lite = JSON.parse(await readFile("scripts/native-media-lite.lock.json", "utf8"));
    expect(lite.status).toBe("CANDIDATE_NOT_APPROVED");
    expect(lite.distributable).toBe(false);
    const media = JSON.parse(await readFile("scripts/native-source-media.lock.json", "utf8"));
    expect(media.variant).toBe("source-candidate");
    expect(media.distributable).toBe(false);
    expect(media.producerCiConclusion).toBe("FAIL"); expect(media.originalCiClosureValid).toBe(false);
    const release = await readFile(".github/workflows/source-community-build.yml", "utf8");
    expect(release).toContain("MOVIE_MEDIA_VARIANT: source-candidate");
  });
  it("uses the same pinned inputs in its read-only transport probe", async () => {
    const probe = await readFile(".github/workflows/native-source-input-check.yml", "utf8");
    expect(probe).toContain("contents: read"); expect(probe).toContain("prepare-source-release-inputs.mjs");
    expect(probe.match(/contents: write/g)).toHaveLength(1);
    expect(probe).toContain("path: .tmp/native-source-inputs/transport-verification.json");
    expect(probe).not.toMatch(/npm ci|gh release|candidate-private|\.zip\s*$/m);
  });
});
