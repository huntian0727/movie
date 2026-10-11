---
date: 2026-10-11
branch: ai/real-hevc-audio-confirmation
type: docs
status: partial
---

# 真实 H.265 / PCM A-law 声音补证

## Context

用户针对沙盒中补播的 2560×1440 真实 H.265 / PCM A-law 视频明确回复“声音正常”。该反馈对应既有匿名样本 C，不代表其他样本的音轨或 GUI 时长准确性通过。

基准 `016b0354910c14da2a25a0e59fc8216b1e487d2a`，开始时工作区干净。开发前快照 `2026-10-11_06-38-03-670_real-hevc-audio-confirmation`，checkpoint `checkpoint-20261011-143759-016b035-real-hevc-audio-confirmation` 已推送，SQLite 一致性快照 345892 条、quick_check 正常。随后维护脚本校验最近三份开发和三份迁移备份，清理一份旧开发快照、错误零。

## Changes

- [真实媒体证据](../../QA/2026-10-11-sandbox-real-media-evidence.json) 中仅样本 C 的 audio 由未确认改为 `PASS_USER_CONFIRMED`，保存原回复、反馈定位标识及适用范围。
- 同步 [稳定版验收方案](../../QA/WINDOWS11_CLEAN_INSTALL_TEST.md) 与 [Release 草稿](../../release-notes-v0.1.15-draft.md)，保持其他样本状态和既有时长诊断不变。
- 本轮只更新四份文档，没有重新播放、删除媒体、重启沙盒、修改程序或生成新桌面包。

## Verification

- 独立证据核对：只有样本 C 的 audio 对象变化，其他真实媒体字段、时长诊断、合成样本证据、审批文件及运行库锁与基准逐字节/结构比对保持一致。四份待提交路径全部为 docs，23 个本地文档链接有效。
- 本轮重新使用锁定 Node 22.23.1 / npm 10.9.8 环境执行 `npm run lint`、`npm run typecheck`、`npm run build`：PASS；`npm test`：134 个文件、1204 项 PASS；`npm run test:electron-smoke`：PASS，含 SQLite、三身份/DPAPI/移动目录重开、preload 和主进程；`npm run test:media-candidate-contract`：60/60 PASS。独立 E2E npm 脚本不存在，记为不适用。本轮没有追加 GUI 复测。
- 构建体积提示与 PNG 色彩配置警告未导致失败。临时检查 runner 初次 PowerShell 引号处理失败、文件未创建；改为保存脚本后完整重跑通过，没有跳过任何检查，也没有修改程序来绕过检查。
- `git diff --check` 与交付脚本 `-ValidateOnly`：PASS。完整等价检查已在本轮同一工作区执行，可使用 `-SkipChecks` 提交并普通快进推送功能分支和 main，推送前保存 main 备份标签。

## Risks and follow-up

- 样本 C 的 GUI 总时长 07:25–07:26 与索引/标题 07:48 存在差异，仍未定位或修复；声音反馈不关闭该问题。
- 样本 B、D、G 的声音仍未由用户确认，F 元数据没有音轨；未逐份完成封面/时间轴预览、4K 和长时兼容性验收。
- 稳定 Windows 11 普通用户、公众包身份及第三方来源/发行审核仍未完成；发行审批和 `distributable=false` 不变。没有创建 GitHub Release 或发行 Tag。
- 继续使用既有私人绿色测试包，本轮未交付新的桌面版本。实际包和之前 GUI 结果见 [真实媒体验收记录](2026-10-11-source-and-local-qa.md)。
