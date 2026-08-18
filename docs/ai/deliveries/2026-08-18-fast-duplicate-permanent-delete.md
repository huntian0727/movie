---
date: 2026-08-18
branch: ai/duplicate-preferred-directory-shortcut
type: feat
status: completed
---

# Fast duplicate candidate permanent deletion

## Context

The user explicitly replaced the previous mandatory SHA-256/two-confirmation contract with an efficiency-first workflow and accepted the risk of permanent deletion based on cached size and duration.

## Changes

- The duplicate page shows `一键永久删除候选移除项（N）` after the keep plan is calculated.
- Clicking the button immediately permanently deletes all candidate-removal items on the current page. It does not hash file contents and does not open a confirmation dialog.
- Preferred directories include every descendant directory. Explicit per-group keep choices remain authoritative.
- The renderer submits only a keep/delete ID plan. The main process rebuilds every current duplicate group and rejects missing groups, cross-group IDs, deleting the keep item, or plans that do not keep exactly one item.
- The dedicated `duplicate:fast-delete` channel is main-window only. Generic deletion and scan-failure guards remain unchanged.
- The schema-v10 SHA-256 cleanup task remains available as an optional safe workflow and for historical task compatibility.

## Verification

- Fixed Node `22.23.1` / npm `10.9.8` release gate: PASS.
- Windows file tests: 37 PASS; migrations: 32 PASS; release performance: 21 PASS.
- Full Node suite: 47 files, 475 tests PASS; Node native ABI 127 smoke PASS.
- Focused renderer tests: 65 PASS. Focused fast-delete/main IPC/security tests: 24 PASS.
- Packaged Electron 33.4.11 native/main smoke: PASS; packaged smoke at the final desktop path: PASS.
- Final `app.asar` contains the fast-delete action and the explicit no-SHA/no-second-confirmation warning.

## Desktop package

- Active executable: `C:\Users\test\Documents\视频管理\movie\release\win-unpacked\Local Video Manager.exe`
- Previous package backup: `C:\Users\test\Documents\视频管理\movie\release\win-unpacked.pre-fast-delete-4e7540d`
- Desktop `.lnk` and PowerShell launcher target the active executable.
- Artifact is an unsigned local test package, not a signed Windows installer.

## Risks and follow-up

- The fast path can permanently delete different content that happens to share cached size and duration; the user explicitly accepted this product risk.
- Deletion is immediate and not recoverable through the application.
- The preserved previous package consumes disk space and can be removed after the user confirms the replacement behaves as intended.
