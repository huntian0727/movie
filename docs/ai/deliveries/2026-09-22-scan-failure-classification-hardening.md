---
date: 2026-09-22
branch: ai/scan-failure-classification-hardening
type: fix
status: completed
---

# 扫描异常损坏判定防误删修正

## Context

异常中心曾把 `moov atom not found`、`Invalid data found when processing input` 等 FFprobe 文本直接归类为“确认损坏”。实际案例证明，扩展名为 `.mp4` 的文件可能是包含可播放 MOV 的 ZIP 压缩包；远端挂载读取不完整和特殊封装也可能产生相同错误，因此旧规则存在误判及误删风险。

## Changes

- 永久删除资格不再由 FFprobe 错误文本触发，只接受独立复核流程写入的结构化 `CONFIRMED_CORRUPT` 错误码。
- 所有历史 `INVALID_MEDIA`、`moov atom not found`、`invalid data` 和 `error reading header` 记录立即降级为“媒体解析失败，需复核”，不再显示永久删除入口。
- 元数据解析失败后最多读取文件开头 32 字节，识别 ZIP、RAR、7z、GZIP、PDF、常见图片和可执行文件签名；命中后记录为 `CONTENT_TYPE_MISMATCH`，明确显示“扩展名与内容不一致”。
- 文件头检查仅在 FFprobe 已经失败后执行，设置 5 秒上限；检查本身失败时保留原异常，不阻塞扫描队列，也不会扩大为损坏判定。
- 更新异常中心安全说明、数据库错误码规范化及相关主进程/界面回归测试。

## Verification

- `npm run typecheck`：PASS。
- 针对性测试：PASS，4 个测试文件、45 项测试全部通过。
- `tests/renderer/ScanFailuresPage.test.tsx`：PASS，9 项测试全部通过。
- `npm test`：PASS，73 个测试文件、676 项测试全部通过。
- `npm run dist:win`：PASS。
- `npm run verify:artifact`：PASS，3983 个 ASAR 条目。
- `npm run test:packaged-smoke`：PASS。
- `Local-Video-Manager-0.1.15-x64-Setup.exe /S`：PASS，安装成功。

## Risks and follow-up

- 本次优先消除误删风险；普通 FFprobe 失败不会自动成为“确认损坏”，因此真正损坏的视频需要后续独立复核流程产生 `CONFIRMED_CORRUPT` 才能在异常中心永久删除。
- 文件头检查只识别明确的非视频格式，不尝试凭少量字节断言视频一定损坏，避免对特殊视频封装产生新的误判。
- 已有异常记录无需数据库迁移：分类规则更新后会立即降级；对单个项目重新执行“分析元数据”可写入更明确的“扩展名与内容不一致”结果。
