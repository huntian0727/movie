---
date: 2026-10-07
branch: security/clouddrive-secret-hardening
type: fix
status: verified
---

# CloudDrive 凭据与传输安全加固

## Context

处理 GitHub Issue #20。基于 origin/main `61382ed` 创建指定分支，不更新 main，不合并 PR #19，不改 Git 历史。开发前快照 `2026-10-07_13-04-04-398_clouddrive-secret-hardening`（manifest ID 使用 UTC；北京时间 2026-10-07 21:04:04），标签 `checkpoint-20261007-210358-61382ed-clouddrive-secret-hardening` 已推送。SQLite quick_check ok，345584 视频。

## Changes

- 新增 main-only `credentialStore.ts`：safeStorage 加密、密文原子替换、fsync 和解密校验，Windows 使用 DPAPI；无明文/弱 Linux basic_text 回退。
- `settingsStore.ts` 普通持久化与读取都排除 apiToken。启动先迁移并验证旧 Token，再从普通 settings 删除字段，保留其他配置。迁移失败保留原配置，固定消息中止启动，可恢复环境后重试。恢复旧快照时以 legacy 配置为迁移事实源。
- shared 类型分为只读公开 AppSettings/CloudDrivePublicSettings 与只写 AppSettingsUpdate。IPC 及 sandboxed preload 都使用公开字段投影；Player 不暴露写配置 API，也无凭据读取入口；settings:changed 仍使播放器重新读取公开设置。
- SettingsPage 默认 Token 空白，显示“已配置”；留空保留已有凭据，新值成功保存后清空；连接测试先保存再使用 main-only Token。
- CloudDrive runtime 显式接收主进程凭据，扫描、浏览、删除仍使用原 gRPC 链路。UI/IPC/settings 保存及环境变量/gRPC 网络边界共享 endpoint 策略：HTTP 仅 localhost/127.0.0.0/8/::1，其余 HTTPS；不接受 URL userinfo/path/query/fragment，保留正常 TLS 证书校验。
- settings:set 失败仅转发固定错误消息；实际/历史轮换 Token 与编码形式在日志/诊断中脱敏；gRPC 错误丢弃原始异常对象/cause，服务端错误文本也脱敏。
- 备份 manifest 可选包含 CloudDrive 密文并验证 checksum；旧 manifest 兼容。Windows CI Electron 阶段增加编译，smoke 用真实 safeStorage 及主窗口/Player sandboxed bridge 检查迁移、持久化和不泄露。
- 首次 PR CI 的生产依赖审计发现现有 `electron-store → conf → ajv → fast-uri 3.1.5` 高危问题；仅将 lockfile 的 fast-uri 更新到兼容版本 3.1.8（无其他依赖变化），不降低审计门槛。

## Verification

- 首次系统默认 `npm test`：FAIL（环境），Node 24.14.0/npm 11.9.0 不符合项目固定版本。
- 项目已有 `.tmp/run-node22.cjs` 提供 Node 22.23.1/npm 10.9.8；初次 native node smoke：FAIL（现有 SQLite 是 Electron ABI 130）。已保留原 Electron binding 后重建 Node ABI 127，`verify:native:node` PASS。
- 固定 Node 22 `typecheck`：PASS（`lint` 是同一 typecheck 别名，未重复执行）。
- 两轮 `test:node` 全量（分别 2 workers、1 worker）：各 122 文件 / 1053 项，1052 PASS、1 FAIL。唯一失败为未改动的 `assetCenterPerformance` 计时断言：2207.23 ms / 2116.80 ms，门槛 2000 ms。未修改查询实现或降低门槛。
- 该性能文件单独重跑：PASS，资产中心 1695.78 ms < 2000 ms，metadata issues 658.95 ms < 3000 ms。所有 1053 项均取得通过结果，但没有一次连续全量命令全绿，保留此限制。
- 首次 GitHub Windows CI 的 `test:release-gate`：PASS；连续全量 122 文件 / 1053 项全部通过，资产中心门槛实测 1312.76 ms。上述“没有连续全绿”仅指本机两轮，不包含此远程成功结果。运行链接：https://github.com/huntian0727/movie/actions/runs/37631629232/job/112827103844 。
- 最终专项命令 `vitest run tests/main/cloudDriveCredentialStore.test.ts tests/main/cloudDriveEndpoint.test.ts tests/main/cloudDriveSecurity.test.ts tests/main/cloudDriveGrpcClient.test.ts tests/main/cloudDriveMountedScanner.test.ts tests/main/cloudDriveLegacyBindingService.test.ts tests/main/settingsStore.test.ts tests/main/security.test.ts tests/main/logging.test.ts tests/renderer/SettingsPage.test.tsx tests/renderer/CloudDriveFolderDialog.test.tsx tests/scripts/projectBackup.test.mjs --maxWorkers=2 --minWorkers=1`：12 文件 / 112 项 PASS。包括真实注册 IPC 的两个角色、编译 preload、loopback gRPC Bearer、迁移失败恢复、Token 轮换/空白保留、日志/诊断脱敏、网络调用前拒绝 HTTP 和备份密文校验。
- `test:windows-files -- --maxWorkers=2 --minWorkers=1`：4 文件 / 37 项 PASS。完整测试也覆盖数据库迁移、本地/NAS 扫描、删除安全、播放器、字幕及同步；未额外运行 `test:release-gate` 聚合别名。
- `build`、`package:dir`：PASS。Vite 保留现有 >500 kB chunk 警告；生成的是未签名测试包。
- `prepare:electron`：PASS（Electron 33.4.11 / ABI 130）；`test:electron-smoke`：PASS，真实 Windows safeStorage + electron-store 迁移/替换/重开、主窗口和 Player sandboxed preload 均通过。首次扩展 smoke 因临时 Chromium 缓存占用清理失败，已将清理移到子进程退出后、保持两窗口之间进程存活，并增加完成标记，防止提前 exit 0 假通过。
- `verify:artifact`：PASS，4111 asar entries，无禁止的开发产物。`test:packaged-smoke`：PASS，扫描 fixture、预览生成/缓存/重新生成、数据库重开、worker 查询、协议读取、Player 最小桥接、CSP/导航/IPC sender 限制全部通过；恶意页面探测中的拒绝日志属于预期结果。
- `npm audit --omit=dev --audit-level=high`：首次 PR CI FAIL（fast-uri），兼容更新后本机 PASS / 0 漏洞；开发依赖审计仍有既存问题，不在此生产依赖结论内。更新依赖后重新执行上述 12 文件 / 112 项安全专项：PASS。
- 首次远程 Electron job 的测试页缺少 preload bridge，未误报通过；测试 runner 规范化 Windows TEMP 的 8.3 路径、使用明确 entry URL 和相对脚本的绝对 preload 路径，并增加 preload-error/URL 诊断。修复后本机真实 Electron 两角色 smoke PASS，远程最终结果见 PR Checks。
- 桌面实际交付：重新生成 `release/win-unpacked`；`C:\Users\test\Desktop\拉面影视.lnk` 实际目标为 `C:\Users\test\Documents\视频管理\movie\release\win-unpacked\拉面影视.exe`。从该快捷方式启动并检查设置页，Token 为空白且 placeholder 显示已配置；实际用户旧 apiToken 字段不存在、密文文件存在（仅输出布尔值）。留空“保存并测试连接”成功：API 返回 1 个挂载点，1 个已挂载、1 个可写。未输入/打印/轮换真实 Token，未执行媒体删除。
- 提交使用仓库交付脚本 `finish-and-push.ps1 -SkipMainUpdate -SkipChecks`：不更新 main；SkipChecks 依据上面同工作区已执行的等价检查，避免固定 Node/Electron ABI 切换和重复计时测试，失败和重跑均如实记录。无独立 `test:e2e`/`e2e` 脚本，打包 E2E 使用实际 `test:packaged-smoke`。

## Risks and follow-up

- DPAPI 保护同机其他用户，不能抵御同一 Windows 用户权限的本机恶意程序；密文跨用户/系统恢复可能无法解密，需要重新输入 Token。
- 无法提供安全存储/写盘或迁移时不会回退明文；原配置保留，用户恢复安全存储/目录权限后可重试。
- 历史备份中已存在的 plaintext 不会自动删除；未扫描/重写 Git 历史，未轮换线上密钥。#21 许可证/二进制合规与 #22 发布治理/历史扫描仍待处理。
- 真实本机 CloudDrive2 连接测试 PASS；完整 CloudDrive2/115 扫描、清理实机 E2E、远程 TLS、自签名证书环境和 NAS/SMB 断线测试 NOT RUN，依靠合成 gRPC 和现有自动化回归覆盖。未删除用户媒体。
- 全量性能计时存在负载敏感性：两次全量超门槛、单独重跑通过，后续可在固定 CI 硬件继续观察；本次没有调整性能门槛。
