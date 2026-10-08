---
date: 2026-10-08
branch: ai/public-release-audit
type: test
status: partial
---

# Public release handoff: pinned native media candidate evaluation

## Context

Continue PR #24 without modifying `main`, making a public Release, or altering the approved signing/license gates. The existing actual FFmpeg 6.1.1 and FFprobe 4.0.2 have unresolved maintenance and corresponding-source risks.

## Changes

- Added `scripts/native-media-candidate.lock.json` to pin the BtbN 2026-10-05 LGPL Windows x64 candidate, immutable release tag/source commit, ZIP SHA-256, EXE hashes, and bundled license checksum.
- Added `scripts/verify-native-media-candidate.mjs` to check ZIP digest, Win64 PE signature, both precise native binary hashes, matching executable version and build configuration, GPL/nonfree flags and reported LGPL license; generates an **unapproved** evidence JSON only outside the repository.
- Added five executable regression checks in `tests/scripts/nativeMediaCandidate.node-test.mjs` and integrated them into `test:release-gate`, without reducing existing tests or performance thresholds.
- Wrote owner approval matrix and updated the binary-security audit. No runtime FFmpeg/FFprobe binary, production package, code signing, license declaration or `build/release-approval.json` approval field was changed.

## Verification

- Starting branch `ai/public-release-audit`, HEAD `8c51e93`, worktree clean; origin main `807c495` and PR #24 Draft confirmed.
- Required source/database checkpoint before changes: `2026-10-08_15-13-01-454_public-release-handoff-continuation`, tag `checkpoint-20261008-231254-8c51e93-public-release-handoff-continuation`, pushed; SQLite quick_check OK.
- `npm run test:media-candidate-contract`: PASS (5/5). Candidate archive download and SHA-256: PASS, upstream immutable asset digest matches. Candidate version/build/PE/license inspections: PASS.
- Synthetic-only 1-second MP4 generation, FFprobe JSON/duration/dimensions, JPG cover and timeline-frame extraction with both new executables: PASS.
- First `test:release-gate`: FAIL (131/132 Vitest suites passed, all 1175 existing tests passed). New `tests/scripts/nativeMediaCandidate.test.mjs` was accidentally discovered by Vitest, whose bundler rejects the Node built-in `node:test`; this did not indicate an application test failure. Retained the failure log at `.tmp/handoff-20261008-release-gate.log`.
- Corrective change: renamed the native Node test to `nativeMediaCandidate.node-test.mjs`, updated its explicit `node --test` script path. Re-ran the 5/5 native Node tests successfully. Full `npm run test:release-gate` second attempt: **PASS / exit 0** (131 Vitest files, 1175 existing tests, no skips; 320.88s Vitest stage; additional 5/5 Node candidate tests). Original performance budgets and tests were unchanged. Second-pass log: `.tmp/handoff-20261008-release-gate-recheck.log`.
- `npm run test:electron-smoke`: PASS (Electron 44.7.0 / ABI 149, main/player sandbox preload, OS safeStorage, app.whenReady). `npm run test:renderer-security-smoke`: PASS (DPAPI/main/player/timeline protocol, external file/script/network denial). `rtk` emitted a nonfatal filter diagnostic in redirected output; both commands actually returned exit 0 and printed explicit smoke success.
- New binary-integrated `dist:win`, `verify:artifact`, `release:metadata`, `test:packaged-smoke`, `test:installer-smoke`: **NOT_RUN**. No application FFmpeg/FFprobe binary was replaced, no new installer built; the prior tested unsigned package is untouched.
- Clean stable Windows 11/no Node and previous signed upgrade: NOT_RUN. Candidate malicious-media CVE exploit tests: NOT_RUN.

## Risks and follow-up

- The downloaded artifact and extracted binaries are isolated at `D:/CodexReleaseAudit/media-candidate-20261008`, not committed/distributed. Local report: `candidate-evidence.json`. `approvedForDistribution=false`.
- Before any actual replacement: verify *complete* corresponding FFmpeg/third-party source, patches and reproducible build chain, all licenses/notices; resolve GPL `ffmpeg-static` JavaScript wrapper, update runtime binary loading, lockfile, manifests and installer, then execute every full package test and clean-machine acceptance.
- GitHub `public-release` API returns HTTP 404 and only the repository owner is an existing collaborator. Independent reviewer, expected publisher, signing certificate and legal approvals need owner action; no weakening of gates.
- Existing tested unsigned installer and its SHA-256 are preserved as the baseline; this handoff does not claim a new installer is delivered. Main/tag/Release remain unchanged.
