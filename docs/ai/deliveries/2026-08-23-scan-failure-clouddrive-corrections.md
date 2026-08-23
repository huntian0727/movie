---
date: 2026-08-23
branch: ai/takeover-scan-clouddrive-corrections
type: fix
status: completed
---

# 扫描异常分流、全筛选批处理与重复项安全删除

## Context

接管前一任项目经理留下的 CloudDrive/扫描异常改动后，按用户确认重新限定删除语义：损坏文件可以永久删除；网盘端已经删除的文件只清理本地索引。重复候选发现继续保持低带宽，但任何重复项永久删除都不得绕过完整 SHA-256。

## Changes

- 将扫描异常处理拆成“确认损坏文件永久删除”和“在线确认远端缺失后清理本地记录”两个独立通道。CloudDrive 缺失确认使用强制刷新父目录的完整列举，离线、取消、权限或读取错误均保持原记录。
- 新增主进程扫描异常批处理任务，支持当前页或全部筛选结果、进度、逐项统计和取消；“复查可访问性”不运行 FFprobe，“分析元数据”才进入媒体分析。
- 损坏文件删除要求入库版本基线，并在删除前复查大小和修改时间；ENOENT 不再被损坏删除入口当作成功。
- 重复页新增单文件和批量“一键验证并删除”。候选浏览不读取内容；提交后后台完整计算保留项与候选移除项 SHA-256，仅完全一致且删除前再次通过版本/内容身份复查的文件自动永久删除。
- 硬禁用原先未计算 SHA-256 的快速永久删除 IPC 与辅助函数，消除 Windows Release Gate 阻断路径。
- 修正 CloudDrive 手工挂载映射缓存键，并增加远端父目录映射、Unicode/大小写匹配的缺失确认覆盖。

## Verification

- Implementation commits before final delivery sync: `9119487`, `a0bb28c`, `37849a8`.
- `npm run typecheck`：PASS。
- Node 22.23.1 全量 `vitest run`：PASS，48 个测试文件、492 项测试。
- `npm run build`：PASS。
- 独立 Electron ABI 工作树：Electron 33.4.11 / ABI 130 native smoke PASS。
- Windows NSIS 打包：PASS；artifact 内容检查 PASS；packaged smoke PASS；installer smoke PASS。
- 真实 CloudDrive2 + 115：NOT RUN。当前终端未配置 `LOCAL_VIDEO_MANAGER_CLOUDDRIVE_TOKEN` 与挂载映射，未读取或搬运用户凭据。

## Risks and follow-up

- 扫描异常批处理状态当前是进程内任务；应用退出会停止任务，但不会在中途批量清理未处理记录。若未来需要跨重启恢复，应新增持久化 job schema。
- npm 安装报告现有依赖含 24 个 audit 告警（3 moderate、19 high、2 critical）；本次未执行可能引入破坏性升级的 `npm audit fix --force`。
- 安装包为未签名测试构建，正式发布仍需代码签名。
