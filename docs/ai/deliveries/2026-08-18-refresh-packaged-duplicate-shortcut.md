---
date: 2026-08-18
branch: ai/duplicate-preferred-directory-shortcut
type: chore
status: completed
---

# Refresh packaged app with recursive preferred-directory shortcut

## Context

The source tree and renderer build contained the new `优先保留此目录` action, but the desktop shortcut still launched a `win-unpacked` package created before the feature. The legacy desktop PowerShell launcher also referenced an obsolete worktree package.

## Changes

- Confirmed all running `Local Video Manager` processes had exited before replacing the package.
- Preserved the previous package at `release/win-unpacked.pre-dupdir-a7f5986`.
- Rebuilt the unsigned Windows directory package at `release/win-unpacked` using Node 22.23.1, npm 10.9.8, and Electron 33.4.11.
- Kept `Video Manager (Dev).lnk` pointed at the refreshed package and updated the desktop `Video Manager.ps1` launcher from the obsolete worktree to the same package path.
- Restored the development checkout's `better-sqlite3` to Node ABI 127 after Electron packaging.

## Verification

- New package timestamp: 2026-08-18 23:17:08.
- `app.asar` renderer contains `优先保留此目录`, `包含所有子目录`, and `清除优先目录`.
- Electron native rebuild and main-process smoke: PASS, Electron ABI 130.
- Packaged smoke: PASS, including packaged mode, database quick check/reopen, renderer/preload, protocol reads, security boundaries, FFmpeg, and FFprobe.
- Post-package development native smoke: PASS, Node ABI 127.
- Desktop shortcut target and PowerShell launcher both resolve to `movie/release/win-unpacked/Local Video Manager.exe`.
- No application process was left running and the user library was not launched during handoff.

## Risks and follow-up

- The directory package is an unsigned local test artifact, not a signed installer release.
- The preserved old package consumes disk space and may be removed later after the user confirms the refreshed application behaves correctly.
- Formal Windows release still requires the remaining checklist evidence, including real mapped/offline SMB validation.
