# 本轮修改文件清单

基线：origin/main 807c495；工作分支：ai/public-release-audit。仅列仓库中的修改和新增文件，不包含 node_modules、临时扫描原始输出、构建产物、用户数据或工作区本地备份维护工具。历史个人路径替换只修改当前文件，Git 历史保持。最终准确差异以 PR 文件列表为准。

## 安全、删除及主进程（20）

- [src/main/clouddrive/mountedScanner.ts](../src/main/clouddrive/mountedScanner.ts)
- [src/main/db/duplicateCleanupRepository.ts](../src/main/db/duplicateCleanupRepository.ts)
- [src/main/db/migrations/015-clouddrive-cleanup-binding.ts](../src/main/db/migrations/015-clouddrive-cleanup-binding.ts)
- [src/main/db/migrations/index.ts](../src/main/db/migrations/index.ts)
- [src/main/files/safePermanentDelete.ts](../src/main/files/safePermanentDelete.ts)
- [src/main/files/scanFailureActions.ts](../src/main/files/scanFailureActions.ts)
- [src/main/index.ts](../src/main/index.ts)
- [src/main/ipc.ts](../src/main/ipc.ts)
- [src/main/media/duplicateCleanupService.ts](../src/main/media/duplicateCleanupService.ts)
- [src/main/media/mediaProtocol.ts](../src/main/media/mediaProtocol.ts)
- [src/main/packagedSmoke.ts](../src/main/packagedSmoke.ts)
- [src/main/playerTimelinePreview.ts](../src/main/playerTimelinePreview.ts)
- [src/main/playerWindow.ts](../src/main/playerWindow.ts)
- [src/main/preload.cts](../src/main/preload.cts)
- [src/main/releaseFlavor.ts](../src/main/releaseFlavor.ts)
- [src/main/rendererProtocol.ts](../src/main/rendererProtocol.ts)
- [src/main/security.ts](../src/main/security.ts)
- [src/main/settings/README.md](../src/main/settings/README.md)
- [src/main/settings/settingsStore.ts](../src/main/settings/settingsStore.ts)
- [src/shared/videoTypes.ts](../src/shared/videoTypes.ts)

## 界面确认和恢复（4）

- [src/renderer/components/DuplicateCleanupTasksPanel.tsx](../src/renderer/components/DuplicateCleanupTasksPanel.tsx)
- [src/renderer/components/DuplicateGroupsPage.tsx](../src/renderer/components/DuplicateGroupsPage.tsx)
- [src/renderer/components/SettingsPage.tsx](../src/renderer/components/SettingsPage.tsx)
- [src/renderer/styles.css](../src/renderer/styles.css)

## 构建、安装和自动化（31）

- [.github/workflows/security-audit.yml](../.github/workflows/security-audit.yml)
- [.github/workflows/windows-ci.yml](../.github/workflows/windows-ci.yml)
- [.github/workflows/windows-release.yml](../.github/workflows/windows-release.yml)
- [.gitignore](../.gitignore)
- [build/installer.nsh](../build/installer.nsh)
- [build/release-approval.json](../build/release-approval.json)
- [electron-builder.yml](../electron-builder.yml)
- [package-lock.json](../package-lock.json)
- [package.json](../package.json)
- [scripts/audit-dependency-licenses.mjs](../scripts/audit-dependency-licenses.mjs)
- [scripts/audit-public-history.mjs](../scripts/audit-public-history.mjs)
- [scripts/build-native-player.mjs](../scripts/build-native-player.mjs)
- [scripts/clean-windows11-acceptance.ps1](../scripts/clean-windows11-acceptance.ps1)
- [scripts/electron-smoke-main.cjs](../scripts/electron-smoke-main.cjs)
- [scripts/install-locked-dependencies.mjs](../scripts/install-locked-dependencies.mjs)
- [scripts/native-player-toolchain.lock.json](../scripts/native-player-toolchain.lock.json)
- [scripts/native-player-toolchain.mjs](../scripts/native-player-toolchain.mjs)
- [scripts/rebuild-electron.mjs](../scripts/rebuild-electron.mjs)
- [scripts/release-after-pack.cjs](../scripts/release-after-pack.cjs)
- [scripts/release-engineering.mjs](../scripts/release-engineering.mjs)
- [scripts/renderer-security-smoke-main.cjs](../scripts/renderer-security-smoke-main.cjs)
- [scripts/run-electron-builder.mjs](../scripts/run-electron-builder.mjs)
- [scripts/run-electron-smoke.mjs](../scripts/run-electron-smoke.mjs)
- [scripts/run-installer-smoke.mjs](../scripts/run-installer-smoke.mjs)
- [scripts/run-packaged-smoke.mjs](../scripts/run-packaged-smoke.mjs)
- [scripts/run-renderer-security-smoke.mjs](../scripts/run-renderer-security-smoke.mjs)
- [scripts/test-native-player-reproducibility.mjs](../scripts/test-native-player-reproducibility.mjs)
- [scripts/verify-packaged-artifact.mjs](../scripts/verify-packaged-artifact.mjs)
- [scripts/write-release-metadata.mjs](../scripts/write-release-metadata.mjs)
- [vite.config.ts](../vite.config.ts)
- [vitest.config.ts](../vitest.config.ts)

## 验证（19）

- [tests/gates/assetCenterPerformance.test.ts](../tests/gates/assetCenterPerformance.test.ts)
- [tests/main/cloudDriveCredentialStore.test.ts](../tests/main/cloudDriveCredentialStore.test.ts)
- [tests/main/cloudDriveRecoveryRuntime.test.ts](../tests/main/cloudDriveRecoveryRuntime.test.ts)
- [tests/main/cloudDriveSecurity.test.ts](../tests/main/cloudDriveSecurity.test.ts)
- [tests/main/databaseMigrations.test.ts](../tests/main/databaseMigrations.test.ts)
- [tests/main/duplicateCleanupJobs.test.ts](../tests/main/duplicateCleanupJobs.test.ts)
- [tests/main/mediaProtocol.test.ts](../tests/main/mediaProtocol.test.ts)
- [tests/main/preloadRendererTrust.test.ts](../tests/main/preloadRendererTrust.test.ts)
- [tests/main/publicReleaseDeletionAdversarial.test.ts](../tests/main/publicReleaseDeletionAdversarial.test.ts)
- [tests/main/releaseFlavor.test.ts](../tests/main/releaseFlavor.test.ts)
- [tests/main/rendererProtocol.test.ts](../tests/main/rendererProtocol.test.ts)
- [tests/main/security.test.ts](../tests/main/security.test.ts)
- [tests/main/stagedRestoreCollision.test.ts](../tests/main/stagedRestoreCollision.test.ts)
- [tests/renderer/DuplicateCleanupTasksPanel.test.tsx](../tests/renderer/DuplicateCleanupTasksPanel.test.tsx)
- [tests/renderer/SettingsPage.test.tsx](../tests/renderer/SettingsPage.test.tsx)
- [tests/scripts/installLockedDependencies.test.mjs](../tests/scripts/installLockedDependencies.test.mjs)
- [tests/scripts/nativePlayerToolchain.test.mjs](../tests/scripts/nativePlayerToolchain.test.mjs)
- [tests/scripts/releaseEngineering.test.mjs](../tests/scripts/releaseEngineering.test.mjs)
- [tests/smoke/scaffold.test.ts](../tests/smoke/scaffold.test.ts)

## 公开工程文档及独立 QA（51）

- [.agent/context/PROJECT_SNAPSHOT.md](../.agent/context/PROJECT_SNAPSHOT.md)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-boundaries-cross-qa.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-boundaries-cross-qa.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-boundaries-dev.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-boundaries-dev.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-deletion-cross-qa.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-deletion-cross-qa.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-deletion-dev.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-deletion-dev.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-deletion-rework-dev.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-deletion-rework-dev.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-distribution-cross-qa.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-distribution-cross-qa.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-distribution-dev.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-distribution-dev.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-empty-state-cross-qa.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-empty-state-cross-qa.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-final-distribution-qa.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-final-distribution-qa.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-final-runtime.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-final-runtime.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-final-source-cross-qa.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-final-source-cross-qa.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-nativehost-toolchain-dev.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-nativehost-toolchain-dev.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-nsis-empty-dir-cross-qa.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-nsis-empty-dir-cross-qa.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-nsis-empty-dir-dev.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-nsis-empty-dir-dev.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-nsis-enumeration-rework-cross-qa.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-nsis-enumeration-rework-cross-qa.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-nsis-enumeration-rework-dev.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-nsis-enumeration-rework-dev.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-nsis-registration-rework-dev.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-nsis-registration-rework-dev.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-performance-fixture-cross-qa.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-performance-fixture-cross-qa.json)
- [.agent/handoffs/PUBLIC-RELEASE-AUDIT-release-environment-qa.json](../.agent/handoffs/PUBLIC-RELEASE-AUDIT-release-environment-qa.json)
- [.agent/handoffs/TASK-SAFETY-001-qa.md](../.agent/handoffs/TASK-SAFETY-001-qa.md)
- [.agent/tasks/active/PUBLIC-RELEASE-AUDIT.md](../.agent/tasks/active/PUBLIC-RELEASE-AUDIT.md)
- [CHANGELOG.md](../CHANGELOG.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [LICENSE](../LICENSE)
- [README.md](../README.md)
- [SECURITY.md](../SECURITY.md)
- [docs/PUBLICATION-HYGIENE.md](../docs/PUBLICATION-HYGIENE.md)
- [docs/clean-windows11-acceptance.md](../docs/clean-windows11-acceptance.md)
- [docs/electron-security.md](../docs/electron-security.md)
- [docs/legal/RELEASE-COMPLIANCE.md](../docs/legal/RELEASE-COMPLIANCE.md)
- [docs/legal/THIRD-PARTY-NOTICES.txt](../docs/legal/THIRD-PARTY-NOTICES.txt)
- [docs/legal/dependency-inventory.json](../docs/legal/dependency-inventory.json)
- [docs/legal/native-binary-security.md](../docs/legal/native-binary-security.md)
- [docs/legal/nativehost-toolchain.json](../docs/legal/nativehost-toolchain.json)
- [docs/legal/upstream/agent-base-6.0.2-LICENSE.txt](../docs/legal/upstream/agent-base-6.0.2-LICENSE.txt)
- [docs/legal/upstream/agent-base-6.0.2-LICENSE.txt.provenance.json](../docs/legal/upstream/agent-base-6.0.2-LICENSE.txt.provenance.json)
- [docs/legal/upstream/https-proxy-agent-5.0.1-LICENSE.txt](../docs/legal/upstream/https-proxy-agent-5.0.1-LICENSE.txt)
- [docs/legal/upstream/https-proxy-agent-5.0.1-LICENSE.txt.provenance.json](../docs/legal/upstream/https-proxy-agent-5.0.1-LICENSE.txt.provenance.json)
- [docs/native-abi-workflow.md](../docs/native-abi-workflow.md)
- [docs/public-release-audit.md](../docs/public-release-audit.md)
- [docs/public-release-changed-files.md](../docs/public-release-changed-files.md)
- [docs/release-engineering.md](../docs/release-engineering.md)
- [docs/release-workflow.md](../docs/release-workflow.md)
- [docs/scan-optimization-final-report.md](../docs/scan-optimization-final-report.md)
- [docs/screenshots/public-release-delete-warning.jpg](../docs/screenshots/public-release-delete-warning.jpg)
- [docs/screenshots/public-release-duplicate-empty.jpg](../docs/screenshots/public-release-duplicate-empty.jpg)
- [docs/screenshots/public-release-library.jpg](../docs/screenshots/public-release-library.jpg)
- [docs/superpowers/plans/2026-07-09-video-manager-implementation.md](../docs/superpowers/plans/2026-07-09-video-manager-implementation.md)
- [docs/verification-results.md](../docs/verification-results.md)
- [docs/windows-installation.md](../docs/windows-installation.md)

## 历史文档当前版本脱敏及交付（42）

- [docs/ai/START_HERE.md](../docs/ai/START_HERE.md)
- [docs/ai/deliveries/2026-08-16-remove-web-demo-mode.md](../docs/ai/deliveries/2026-08-16-remove-web-demo-mode.md)
- [docs/ai/deliveries/2026-08-18-fast-duplicate-permanent-delete.md](../docs/ai/deliveries/2026-08-18-fast-duplicate-permanent-delete.md)
- [docs/ai/deliveries/2026-08-21-project-manager-handoff.md](../docs/ai/deliveries/2026-08-21-project-manager-handoff.md)
- [docs/ai/deliveries/2026-08-24-clouddrive-api-duplicate-cleanup.md](../docs/ai/deliveries/2026-08-24-clouddrive-api-duplicate-cleanup.md)
- [docs/ai/deliveries/2026-08-25-clouddrive-api-library-source.md](../docs/ai/deliveries/2026-08-25-clouddrive-api-library-source.md)
- [docs/ai/deliveries/2026-08-25-clouddrive-legacy-binding-speed.md](../docs/ai/deliveries/2026-08-25-clouddrive-legacy-binding-speed.md)
- [docs/ai/deliveries/2026-09-01-preview-flicker.md](../docs/ai/deliveries/2026-09-01-preview-flicker.md)
- [docs/ai/deliveries/2026-09-01-preview-loading.md](../docs/ai/deliveries/2026-09-01-preview-loading.md)
- [docs/ai/deliveries/2026-09-02-manual-local-reconcile.md](../docs/ai/deliveries/2026-09-02-manual-local-reconcile.md)
- [docs/ai/deliveries/2026-09-03-duplicate-delete-live-refresh.md](../docs/ai/deliveries/2026-09-03-duplicate-delete-live-refresh.md)
- [docs/ai/deliveries/2026-09-04-default-maximized.md](../docs/ai/deliveries/2026-09-04-default-maximized.md)
- [docs/ai/deliveries/2026-09-04-duplicate-page-performance.md](../docs/ai/deliveries/2026-09-04-duplicate-page-performance.md)
- [docs/ai/deliveries/2026-09-04-nonblocking-duplicate-cleanup.md](../docs/ai/deliveries/2026-09-04-nonblocking-duplicate-cleanup.md)
- [docs/ai/deliveries/2026-09-04-ui-v1-final-release.md](../docs/ai/deliveries/2026-09-04-ui-v1-final-release.md)
- [docs/ai/deliveries/2026-09-23-ui-performance-v1.md](../docs/ai/deliveries/2026-09-23-ui-performance-v1.md)
- [docs/ai/deliveries/2026-10-01-video-list-storyboard.md](../docs/ai/deliveries/2026-10-01-video-list-storyboard.md)
- [docs/ai/deliveries/2026-10-01-visible-storyboard-metadata.md](../docs/ai/deliveries/2026-10-01-visible-storyboard-metadata.md)
- [docs/ai/deliveries/2026-10-02-cloud-storyboard-progress.md](../docs/ai/deliveries/2026-10-02-cloud-storyboard-progress.md)
- [docs/ai/deliveries/2026-10-02-video-view-action-parity.md](../docs/ai/deliveries/2026-10-02-video-view-action-parity.md)
- [docs/ai/deliveries/2026-10-03-embedded-player-bridge-acceptance.md](../docs/ai/deliveries/2026-10-03-embedded-player-bridge-acceptance.md)
- [docs/ai/deliveries/2026-10-03-unified-player-mpv.md](../docs/ai/deliveries/2026-10-03-unified-player-mpv.md)
- [docs/ai/deliveries/2026-10-04-floating-player-timeline-preview.md](../docs/ai/deliveries/2026-10-04-floating-player-timeline-preview.md)
- [docs/ai/deliveries/2026-10-04-player-consistency-performance.md](../docs/ai/deliveries/2026-10-04-player-consistency-performance.md)
- [docs/ai/deliveries/2026-10-04-player-pause-response-fix.md](../docs/ai/deliveries/2026-10-04-player-pause-response-fix.md)
- [docs/ai/deliveries/2026-10-04-player-rotation-return-fix.md](../docs/ai/deliveries/2026-10-04-player-rotation-return-fix.md)
- [docs/ai/deliveries/2026-10-04-player-startup-priority-fix.md](../docs/ai/deliveries/2026-10-04-player-startup-priority-fix.md)
- [docs/ai/deliveries/2026-10-05-background-performance-v1.md](../docs/ai/deliveries/2026-10-05-background-performance-v1.md)
- [docs/ai/deliveries/2026-10-05-embedded-fullscreen-controls.md](../docs/ai/deliveries/2026-10-05-embedded-fullscreen-controls.md)
- [docs/ai/deliveries/2026-10-05-interaction-polish-v1.md](../docs/ai/deliveries/2026-10-05-interaction-polish-v1.md)
- [docs/ai/deliveries/2026-10-05-online-subtitles-v1.md](../docs/ai/deliveries/2026-10-05-online-subtitles-v1.md)
- [docs/ai/deliveries/2026-10-06-directory-cards-tree.md](../docs/ai/deliveries/2026-10-06-directory-cards-tree.md)
- [docs/ai/deliveries/2026-10-07-clouddrive-hardening.md](../docs/ai/deliveries/2026-10-07-clouddrive-hardening.md)
- [docs/ai/deliveries/2026-10-07-directory-drag-sort.md](../docs/ai/deliveries/2026-10-07-directory-drag-sort.md)
- [docs/ai/deliveries/2026-10-07-directory-image-viewer.md](../docs/ai/deliveries/2026-10-07-directory-image-viewer.md)
- [docs/ai/deliveries/2026-10-07-image-mounted-directory-fix.md](../docs/ai/deliveries/2026-10-07-image-mounted-directory-fix.md)
- [docs/ai/deliveries/2026-10-08-public-release-audit.md](../docs/ai/deliveries/2026-10-08-public-release-audit.md)
- [docs/ai/qa/2026-09-04-playback-diagnostic-v1-qa-retest.md](../docs/ai/qa/2026-09-04-playback-diagnostic-v1-qa-retest.md)
- [docs/ai/qa/2026-09-04-ui-v1-final-release-qa.md](../docs/ai/qa/2026-09-04-ui-v1-final-release-qa.md)
- [docs/ai/qa/2026-10-03-unified-player-controls.md](../docs/ai/qa/2026-10-03-unified-player-controls.md)
- [docs/ai/reports/2026-10-03-embedded-mpv-spike.md](../docs/ai/reports/2026-10-03-embedded-mpv-spike.md)
- [docs/ai/reports/2026-10-05-performance-remaining-v2.md](../docs/ai/reports/2026-10-05-performance-remaining-v2.md)


## 2026-10-08 接手后新增（在上列原始 167 文件 PR 变更以外）

- `scripts/native-media-candidate.lock.json`：固定候选来源/版本/哈希，明确不授权分发。
- `scripts/verify-native-media-candidate.mjs`：独立候选二进制检验、证据生成，拒绝错配及 GPL/nonfree 开关。
- `tests/scripts/nativeMediaCandidate.node-test.mjs`：5 项快速候选契约单测。
- `package.json`：将候选契约单测接入完整 release gate，不减少既有门禁。
- `docs/legal/native-binary-security.md`：新增实际候选实测与剩余源代码许可阻塞。
- `docs/public-release-owner-decisions.md`：业主需要批准的集中决策，不是批准文件。
- `docs/public-release-audit.md`：接手状态和风险补充。
- `docs/ai/deliveries/2026-10-08-release-handoff-media-candidate.md`：本轮真实交付记录。

若与 PR 当前文件清单产生差异，以实际 `git diff` 及 PR 文件列表为准。未分发候选压缩包/EXE、临时合成媒体、证据 JSON 和测试日志。

## 2026-10-09 后续默认安全修改

- `src/main/media/duplicateCleanupService.ts`：服务端 fail-closed 禁止遗留自动/无哈希删除、筛选全集提交、旧 fast 作业恢复重试以及 worker 启动，移除隐式自动确认。
- `src/renderer/components/LibraryShell.tsx`：面向公众仅连接“完整 SHA-256 验证”两阶段提交，不暴露快速永久删除回调。
- `src/renderer/components/DuplicateGroupsPage.tsx`：无快速删除回调时不提供单项快速按钮，候选数据不是内容相同证明的提示更明确。
- `src/renderer/components/DuplicateCleanupTasksPanel.tsx`：旧 fast 任务显示为停用，不提供继续/重试按钮；保留取消和终止清理记录能力。
- `tests/main/duplicateCleanupJobs.test.ts`：旧行为用同等验证范围的失败关闭测试取代，新增旧请求重放、筛选提交拒绝测试；不删除测试。
- `tests/renderer/DuplicateGroupsPage.test.tsx`：与新安全提示一致的断言。
- `docs/ai/deliveries/2026-10-09-public-release-safe-delete-default.md`：独立交付及测试证据。
- `docs/windows-installation.md`、`docs/public-release-audit.md`、`docs/public-release-owner-decisions.md`：更新当前默认行为与剩余阻塞。

## 2026-10-09 同套 FFmpeg/FFprobe 原生工具接入

- `package.json` / `package-lock.json`：去掉两套旧 ffmpeg/ffprobe npm 包装层及间接依赖，加入安全来源准备阶段。
- `scripts/prepare-native-media.mjs`：下载/验证固定哈希的 win64 LGPL 同源 ZIP，独立暂存。对源 ZIP、执行文件与 LGPL 文本失败关闭。
- `src/main/media/mediaBinaries.ts`：新增统一运行工具定位，打包缺失拒绝退回 PATH。`src/main/media/cacheService.ts`、`metadataService.ts`、`src/main/packagedSmoke.ts` 改成独立原生路径。
- `electron-builder.yml`、`scripts/run-electron-builder.mjs`、`scripts/release-engineering.mjs`、`scripts/verify-packaged-artifact.mjs`、`scripts/write-release-metadata.mjs`（原脚本复用）、`scripts/run-installer-smoke.mjs`、`scripts/clean-windows11-acceptance.ps1` 更新为打包独立 `resources/media-tools`、验证哈希、许可文本与安装保护。
- `tests/main/mediaBinaries.test.ts` 新增五项 locator 失败关闭测试；`tests/main/cacheService.test.ts`、`tests/fixtures/syntheticLibrary.ts`、`tests/scripts/releaseEngineering.test.mjs` 及脚本辅助路径相应更新，不删单测。
- `scripts/audit-dependency-licenses.mjs`、`docs/legal/dependency-inventory.json`、`docs/legal/THIRD-PARTY-NOTICES.txt` 按精确新锁文件刷新，`docs/legal/FFMPEG-SOURCE-CANDIDATE.md` 和 `ffmpeg-source-candidate-inventory.json` 记录真实源码来源/残余许可阻塞。
- `docs/legal/native-binary-security.md`、`docs/legal/RELEASE-COMPLIANCE.md`、`docs/public-release-audit.md`、`docs/ai/deliveries/2026-10-09-media-binary-wrapper-removal.md` 更新审计和交付证明。

## 2026-10-09 B5 家用机源码闭包初审

- `scripts/audit-native-media-recipes.mjs`：以已固定的构建工程 source tar SHA-256 验证为前置，解析候选 recipe 的确切 Git SHA / SVN 版本，导出文件哈希、直接依赖提示及补丁引用；不执行不可信上游 Bash，也不设置授权批准。
- `tests/scripts/nativeMediaRecipeAudit.node-test.mjs`：新增可执行合同测试，包含错误修订拒绝、异常 URL、遍历路径、哈希不符及授权仍为 false。
- `package.json`：把新合同测试追加到已有 `test:media-candidate-contract`，因此完整 release gate 也会检查。
- `docs/legal/native-media-recipe-evidence.json` 和 `docs/legal/FFMPEG-RECIPE-SOURCE-AUDIT.md`：43 个库的机器可读初审证据及局限性；未归档全部源码/授权，不构成正式分发许可。
- `docs/legal/FFMPEG-SOURCE-CANDIDATE.md`、`docs/public-release-audit.md`、`docs/ai/deliveries/2026-10-09-native-media-source-trace.md`：同步安全/发布阻塞及实际测试。

## 2026-10-09 FFmpeg 源码授权根文件批量取证

- `scripts/audit-native-media-licenses.mjs`：对仅限 GitHub 的固定 40 字符 Git SHA 仓库读取根 Git tree，下载候选 NOTICE/COPYING/LICENSE 等 Git blobs，验证标准 Git 对象 SHA1 和源文件 SHA256；仅 B5 本地 D 盘保留原始文本；异常失败关闭并按未验证记录，未经授权不允许改变发行许可。
- `tests/scripts/nativeMediaLicenseAudit.node-test.mjs`：6 个 Node 合同测试（非法来源、浮动修订、恶意路径、损坏 blob、审批标记与无许可证情形）。
- `package.json`：`test:media-candidate-contract` 加入新 Node 测试，原 12 项继续保留，合计 18 项。
- `docs/legal/native-media-license-availability.json`：29/29 个精确 Github 来源仓库、49 份原始许可证候选文件的来源哈希数据，0 项发行授权批准。
- `docs/legal/NATIVE-MEDIA-LICENSE-EVIDENCE.md`：根目录文本证据的界限、13 个未调查非 GitHub 仓库与残余许可证义务。
- `docs/ai/deliveries/2026-10-09-native-license-github-evidence.md`：本轮实际测试、来源存档、风险和剩余工作。
