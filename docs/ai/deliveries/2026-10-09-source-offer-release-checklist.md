---
date: 2026-10-09
branch: ai/public-release-audit
type: docs
status: PASS_WITH_OPEN_RELEASE_BLOCKERS
---

# Free-sharing release documents: corresponding source and final go/no-go

## Context
User requested continuous execution toward lowest-friction free open-source installer. Confirmed **HOME MP2T8QB5**, clean branch `ai/public-release-audit` at `fc39e5e09525ff19527190b6c44f0bef1b3c943b`. Checked latest existing GitHub Windows CI `37923930333` and Security audit `37923930321`: **SUCCESS**. Main stays at `807c49585d18c901b199fe0d3d8b0dbf31eb4114`, PR #24 Draft. NO office machine operation.

Required backup before any edit: snapshot `2026-10-09_11-49-01-288_source-offer-release-checklist-20261009`, Git tag `checkpoint-20261009-194856-fc39e5e-source-offer-release-checklist-20261009` pushed; SQLite 0.87GB, 345892 videos, quick_check=ok.

## Changes
- `docs/legal/SOURCE_OFFER.md`: clear links to verified FFmpeg8.1.2 source SHA, fixed Windows build scripts, original MSYS2 build/package evidence, and explicit instructions for corresponding sources at the *same real public GitHub Release* (not currently published).
- `docs/legal/LGPL_COMPLIANCE_CHECKLIST.md`: precise PASS/OPEN gating and prohibition on claiming complete LGPL/static relink compliance.
- `docs/legal/THIRD_PARTY_RELEASE_NOTICES.md`: readable component ownership, version, package license declaration and SPDX evidence pointers, avoiding unsupported legal conclusions.
- `docs/RELEASE_CHECKLIST.md`: concrete final blockers, stable clean Windows 11 acceptance, isolated community identity and safe GitHub release order. Important correction: community version tag must match actual package version `v0.1.15`, not `v0.1.15-community` because code verifies exact tag.
- No runtime code, packages, approval manifest, source SHA, installer binaries, user DB, actual videos or daily desktop shortcut touched. No public Release action.

## Verification
- GitHub pre-change CI SUCCESS (previous commit; **not** evidence of the doc commit itself).
- `git diff --check`: PASS; no whitespace issues.
- `npm run test:release-gate`: PASS / exit0 using cmd.exe independent process, including 29/29 native media Node provenance tests. Original PowerShell finish wrapper twice encountered benign Git stderr from temporary test repository and exited 1; no test assertions were skipped. `npm run lint`, `npm run typecheck`, `npm run test:electron-smoke`, `npm run test:renderer-security-smoke`, and `npm run build`: independently PASS / exit0; raw ignored logs `.tmp/source-offer-*.log`. This is equivalent full worktree verification, allowing `finish-and-push.ps1 -SkipChecks` to avoid replaying the broken PowerShell stderr adapter.
- Desktop application not rebuilt: **桌面版本尚未交付**.

## Risks and follow-up
- Exact third-party corresponding source archives, static LGPL/relink conditions not fully satisfied; official FFmpeg legal checklist indicates distributing exact matching source/build details.
- True stable clean Windows 11 no Node/manual multimedia QA NOT_RUN, despite isolated Insider QA PASS.
- Community public profile remains unapproved and must not be forced through. Keep PR Draft and protected main intact.
