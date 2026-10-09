---
date: 2026-10-09
branch: ai/public-release-audit
type: fix
status: PASS_WITH_RISKS
---

# Windows CI: scope-limited backup integration test timeout

## Context

On commit `ed753909a2b23c6d73665c922e39d8ddadf89593`, GitHub Windows CI run `37894934030` was **failure**, not success: Node/Windows safety job `113704062970` failed with **one Vitest test timeout at 5000ms**. Logs showed **131/132 suites passed and 1181/1182 tests passed**. Exact failed case: `tests/scripts/projectBackup.test.mjs:136` (`creates a Git checkpoint and data snapshot through the PowerShell workflow`). Its Windows runner executed Git initialization, PowerShell backup, snapshot, and follow-up list inside one default 5-second Vitest limit, and was interrupted. Electron smoke and dependency review passed, installer job was skipped because of this dependency.

All work on **home MP2T8QB5**. Never use the unrelated office D200707. Work branch `ai/public-release-audit` was clean; `main` untouched. Mandatory before-edit full backup succeeded: `2026-10-09_07-04-20-826_fix-windows-ci-backup-timeout` with checkpoint `checkpoint-20261009-150416-ed75390-fix-windows-ci-backup-timeout`; SQLite 0.87 GB, 345892 video index records, quick_check=ok. No user video files altered.

## Changes

- Adjusted **only that PowerShell integration test** to use an explicit `40_000` ms timeout. Its child PowerShell spawn still has a **30,000 ms** timeout, its backup CLI invocations still have **30,000 ms** timeout, and all file/hash/SQLite/rollback asserts are preserved. **No global timeout, performance budgets, security checks or assertions changed.**
- This is a CI reliability change, not a production application change. The actual application behavior, built binaries and installer have not been changed. The existing desktop program has **not been updated**.

## Verification

- `node node_modules/vitest/vitest.mjs run tests/scripts/projectBackup.test.mjs` repeated **3 consecutive times**, each **6/6 PASS**, total 2.73s / 2.72s / 2.74s, with PowerShell integration stage 1.40s / 1.41s / 1.43s on the home PC. Exact logs `.tmp/ci-backup-timing-{1,2,3}.log`.
- `npm run test:release-gate`: **PASS / exit 0** (132 Vitest files, 1182 tests, zero failures/skips; 18/18 native-media contract tests); full elapsed **215.06 s**, Vitest stage **181.03 s**. Exact log `.tmp/ci-backup-timeout-release-gate.log`.
- `npm run test:electron-smoke`: **PASS / exit0**, Electron44.7.0 ABI149, main, sandboxed preload and safeStorage. `npm run test:renderer-security-smoke`: **PASS / exit0**, protocol/IPC/source security. Logs `.tmp/ci-timeout-test-electron-smoke.log` and `.tmp/ci-timeout-test-renderer-security-smoke.log`.
- New Windows GitHub Actions workflow including gated unsigned installer job: PENDING until new commit and workflow completes.
- Fresh clean stable Windows 11 without Node and prior signed-version upgrade: NOT_RUN. No formal release, no main branch update and no install or shortcut change.

## FFmpeg simplification decision and follow-up

A code search confirmed that production FFmpeg usage consists of `ffprobe` format/stream/duration metadata and `ffmpeg` local video cover, timeline frame and still thumbnail extraction to JPEG (scaling and JPEG encoding). The actual video playback path uses the app's own player/native mpv routing, not FFmpeg CLI encoding. A **lean native toolchain without `--enable-lib*` optional third-party plugins** is therefore the preferred next candidate to test; it should include native format demuxers/decoders, image scaling/filter and JPEG still encoder, and must pass synthetic thumbnails/probe, packaged smoke and installer QA on real Windows.

FFmpeg upstream `configure` supports `--disable-autodetect`, `--disable-gpl`, `--disable-nonfree` and default built-in codecs; building this candidate from a pinned upstream source version plus reproducible toolchain and matching source/notice can drastically reduce third-party closure work. **Do not replace currently tested BtbN FFmpeg/FFprobe pair or approve their distribution until this new candidate is actually built, checked for required formats/codecs, its license obligations met, and isolated installer QA succeeds.** B5 has no MSYS2/GCC/Make/NASM installed, so the build must use a reviewed toolchain in an isolated location or GitHub Actions, never alter user OS/production player without validation.

## Risks and follow-up

The test change only addresses the observed 5000ms CI failure. Actual GitHub Windows CI must return SUCCESS before this issue can be marked closed. FFmpeg source and license obligations for the installed 43-library candidate remain unchanged and unapproved until a smaller verified replacement is integrated. Rights to code and assets, history security, clean Win11, upgrade safety, and final publishing/signing choice remain separate work.

**Public distribution remains FAIL and PR #24 stays Draft.**
