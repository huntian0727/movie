---
date: 2026-10-09
branch: ai/public-release-audit
type: fix
status: PASS_WITH_RISKS
---

# Windows public release: Replace legacy FFmpeg/FFprobe npm wrappers with pinned native media tools

## Context

- Prior local and GitHub branch HEAD `47a171a821f65473c95374aa0155fbe74c262b3c`, clean, PR #24 Draft; main `807c49585d18c901b199fe0d3d8b0dbf31eb4114`.
- Windows CI run `37869673597` and security audit run `37869673663` completed **SUCCESS** for the prior commit.
- Required before-edit backup **PASS**: snapshot `2026-10-09_01-38-19-331_public-release-ffmpeg-chain-20261009`; pushed checkpoint `checkpoint-20261009-093815-47a171a-public-release-ffmpeg-chain-20261009`, database 0.87 GB, 345892 videos, SQLite quick_check OK. No user's existing media was modified.

## Changes

1. Eliminated both production dependencies `ffmpeg-static` (GPL-3.0-or-later JS wrapper) and `ffprobe-static` from package and lockfile, removing 14 package records from current installation. Updated `src/main/media/{cacheService,metadataService,mediaBinaries}.ts`, `src/main/packagedSmoke.ts` to load pinned native tools directly, not npm wrappers or PATH. The installed runtime fails closed if its bundled executable is absent.
2. Added `scripts/prepare-native-media.mjs` to acquire and verify the **exact** 2026-10-05 BtbN win64 LGPL release archive and both FFmpeg/FFprobe EXE hashes, version, architecture, configuration and bundled LGPL text. Staging only inside gitignored `native-bin/media-tools` and `.tmp`. Both local existing-artifact mode and **clean URL download with no MOVIE_MEDIA_CANDIDATE_DIR** were actually tested, SHA matched. The source preparer explicitly rejects distribution approval.
3. Changed electron-builder resources and manifest/installer/clean-Windows verification to use physical `resources/media-tools`. Build script rechecks every pinned SHA and LGPL evidence before packaging, and artifact verifier checks packed EXEs against staged originals and prohibits obsolete npm wrapper package paths.
4. Updated release engineering tests, media generator fixture, codec validation/spike helper paths, dependency-license inventory and notices. Synthetic long-GOP timeline test uses the new LGPL-compatible built-in MPEG-4 encoder rather than deprecated GPL-only libx264, without dropping keyframe verification.
5. Collected the exact BtbN build scripts tar at commit `9acad4a9ef1583096af7836cc1e9c8cbcb4d3950` and FFmpeg upstream main source at commit `46d8f462eeb87ee1f704d8c44a0ee24fca471ad1` into isolated D-drive audit storage. Inventory includes **43** enabled external libraries: **43** potentially matching BtbN recipe files (39 matched directly, 4 by library name aliases; this is not proof of corresponding source). No claim that any library's complete corresponding source/patch/license is closed.
6. Added `tests/main/mediaBinaries.test.ts` with 5 cases covering packaged path selection, missing packaged tool refusal (no developer/PATH fallback), developer selection and input validation. Retained existing tests and budgets.

## Verification

- Pinned native version evidence and ZIP exact hashes: **PASS**. Both FFmpeg and FFprobe `n9.0.2-22-g46d8f462ee-20261005`, same LGPL build, no `--enable-gpl` or `--enable-nonfree`.
- `npm ls ffmpeg-static ffprobe-static --all`: **(empty)**. `node scripts/audit-dependency-licenses.mjs`: **PASS**, 414 locked packages, 54 production, zero missing license declaration, both bundled media hashes match source.
- Focused Vitest before adding extra resolver cases: **5 files/46 tests PASS**. New standalone resolver tests: **5/5 PASS**.
- `npm run test:release-gate` at initial migration: **PASS (exit 0)**, no skips, log `.tmp/media-integration-gate.log`. A second final run after newly added resolver cases and packaging hardening should be referenced separately once complete.
- `test:electron-smoke`: **PASS**, Electron44.7.0/ABI149, sandboxed preload, OS safeStorage. `test:renderer-security-smoke`: **PASS**, role/IPC/media/external protocol denial.
- `dist:win`: **PASS**, correctly isolated unsigned x64 NSIS installer, two paired media tools and upstream license in `resources/media-tools`.
- `verify:artifact`: **PASS**, **3461 ASAR entries**, excludes forbidden developer files and the old wrappers. `release:metadata`: **PASS**, unsigned and SHA recorded.
- `test:packaged-smoke`: **PASS**, real packaged Electron, FFmpeg synthetic creation, FFprobe/worker queries and media protocol. `test:installer-smoke`: **PASS**, independent test app ID, install / repair / delete-app-data rejection / uninstall; disposable video and SQLite sentinels preserved inside and outside installation, existing production registrations/shortcuts unchanged. Logs `.tmp/media-integration-*.log`.
- Clean pin download without local candidate env: **PASS (exit 0)**, 171475153-byte official ZIP and matching extracted EXE hashes; log `.tmp/media-download-unset-env-smoke.log`.
- New branch's GitHub CI / security after push: NOT_RUN at document creation.
- Stable clean Windows 11 no development tools, actual signed historical upgrade, original user's shortcut manual launch, FFmpeg malicious-media POC: **NOT_RUN**.

## Risks and follow-up

- Build script does **not** grant any source license authorization or release approval. LGPLv3 upstream license text alone is insufficient for all 43 linked external libraries and potentially necessary relinking material. The raw build/FFmpeg source archives and candidate native bytes remain on D drive, not in the public Git repo or Action release assets. Full legal correspondence/provenance remains P1 and owner approval remains mandatory.
- Application code ownership / MIT choice, privacy scope, protected GitHub `public-release` environment with second reviewer, signing cert/publisher, true clean Win11 and previous signed-version upgrade remain unresolved. **Formal public release FAIL; engineering PASS_WITH_RISKS.**
- Do not merge main, push formal version tag, public Release or public install package. Existing D-drive unsigned baseline installer and user's real production install/data remain unchanged.

## 最终回归新增失败与修复记录（保留）

本次新增 `npm run prepare:media-tools` 作为 `dev:electron` 的必要前置步骤后，最终全量测试 **首次 FAIL（132 文件中 131 通过，1182 项中 1181 通过）**：`tests/smoke/scaffold.test.ts` 旧断言仍要求 `dev:electron` 字符串完全等于此前命令，和新安全前置步骤不一致。此失败是脚本契约断言滞后，**不是媒体测试失败**。保留原日志 `.tmp/media-migration-final-gate.log`，随后更新该精确断言并增加 `dev:electron`、`test:node`、`test:release-gate`、`package:dir`、`dist:win` 均必须准备原生工具以及旧包装层缺失的硬性断言。不删测试、不降低预算；复测另记准确退出码。

## 最终质量门禁复测（前述失败未删除）

2026-10-09 在更新旧脚本断言后重新执行 **完整** `npm run test:release-gate`：**PASS / exit 0**，Vitest **132 files / 1182 tests**、无跳过，新 Node 媒体 candidate **5/5** 通过；原 Windows 文件、迁移、性能与 release budgets 均保留。日志 `.tmp/media-migration-gate-recheck.log`（忽略目录，本地保留）。两项新增 fail-closed 脚本契约集的定向复测：2 files / 11 tests PASS。先前失败 `.tmp/media-migration-final-gate.log` 保留，未冒充首轮通过。

本轮原生工具正式外部依赖仍为 43 个，现已通过 `openapv`/`opencore-amr`/`onevpl` 三类 recipe 名字映射将 43 个的候选构建脚本全部定位到；这不是完整对应源码、许可证或静态链接义务已审核。BtbN 精确 2026-10-05 daily 构建处于上游保留期策略中，14 天后可能被清理，正式分发前必须解决长期可复现来源。
