import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const candidateFile = ".github/workflows/windows-community-candidate.yml";
const signedFile = ".github/workflows/windows-release.yml";
const candidate = await readFile(candidateFile, "utf8");
const signed = await readFile(signedFile, "utf8");

test("unsigned community candidate can only be manually dispatched", () => {
  assert.match(candidate, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(candidate, /^\s+(?:push|pull_request|release):/m);
  assert.match(candidate, /acknowledge_unsigned_candidate/);
  assert.match(candidate, /I_APPROVE_PRIVATE_UNSIGNED_COMMUNITY_CANDIDATE/);
  assert.match(candidate, /inputs\.acknowledge_unsigned_candidate\s*==\s*'I_APPROVE_PRIVATE_UNSIGNED_COMMUNITY_CANDIDATE'/);
});

test("unsigned dispatch must use immutable exact release-version tag", () => {
  assert.match(candidate, /\$env:GITHUB_REF -ne "refs\/tags\/v\$version"/);
  assert.match(candidate, /Get-Content package\.json -Raw/);
  assert.match(candidate, /MOVIE_RELEASE_CLASS: unsigned-public-release/);
  assert.match(candidate, /MOVIE_MEDIA_VARIANT: lite-candidate/);
  assert.match(candidate, /RELEASE_UNSIGNED_PUBLIC_ACKNOWLEDGED: 'true'/);
});

test("owner, third-party and clean Windows manual QA approvals are required", () => {
  for (const name of [
    "RELEASE_LICENSE_APPROVED",
    "RELEASE_BINARY_COMPLIANCE_APPROVED",
    "RELEASE_MANUAL_QA_APPROVED",
  ]) {
    assert.match(candidate, new RegExp(name));
  }
  assert.match(candidate, /\$approval\.approved -ne \$true/);
  assert.match(candidate, /\$approval\.ownersConfirmed -ne \$true/);
  assert.match(candidate, /\$approval\.manualQaApproved -ne \$true/);
  assert.match(candidate, /WIN_CSC_LINK/);
  assert.match(candidate, /CSC_KEY_PASSWORD/);
});

test("candidate has no public release or write credentials", () => {
  assert.match(candidate, /permissions:\s*\n\s+contents: read/m);
  assert.doesNotMatch(candidate, /contents:\s*write/);
  assert.doesNotMatch(candidate, /gh release (create|upload|edit)/);
  assert.doesNotMatch(candidate, /create-release|publish-release/i);
  assert.match(candidate, /actions\/upload-artifact@/);
  assert.match(candidate, /unsigned-community-CANDIDATE-/);
  assert.doesNotMatch(candidate, /release\/unsigned-test-build\/\*Setup/);
  assert.doesNotMatch(candidate, /release\/unsigned-public-release\/\*Setup/);
});

test("candidate must verify artifact and run packaged smoke before archiving", () => {
  assert.match(candidate, /npm run test:release-gate/);
  assert.match(candidate, /npm run test:packaged-smoke/);
  assert.match(candidate, /npm run dist:win/);
  assert.match(candidate, /npm run verify:artifact/);
  assert.match(candidate, /npm run release:metadata/);
  assert.match(candidate, /release\/unsigned-public-release/);
  assert.match(candidate, /com\.local\.video\.manager\.community/);
  assert.match(candidate, /NotSigned/);
  assert.match(candidate, /Get-FileHash -LiteralPath \$installer -Algorithm SHA256/);
});

test("signed release tag trigger is opt-in and requires signed channel", () => {
  assert.match(signed, /if: startsWith\(github\.ref, 'refs\/tags\/'\) && vars\.MOVIE_RELEASE_CHANNEL == 'signed'/);
  assert.match(signed, /name: Approved signed public release/);
});
