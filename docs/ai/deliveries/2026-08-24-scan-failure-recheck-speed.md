---
date: 2026-08-24
branch: ai/scan-failure-recheck-speed
type: fix
status: partial
---

# 扫描异常可访问性复查提速

## Context

“复查可访问性”仍按文件逐个请求 CloudDrive，并在每条结果后重复扫描异常表刷新状态；约 8 万条记录时远慢于使用目录流式列举的文件添加流程。

## Changes

- CloudDrive 复查复用目录级批量确认，同一远端父目录只完整列举一次，不再逐文件 RPC。
- 不同远端目录使用最多 4 路有界并发；本地、NAS、SMB 路径使用最多 32 路有界 `stat`，避免串行等待且不无限放大 I/O。
- 所有远端验证完成后才批量写入结果；数据库使用单个事务更新异常代码、摘要和重试次数，并按源目录一次刷新状态，移除逐条二次方刷新路径。
- 取消或远端流失败时不写入部分复查结果；本地单文件权限/I/O 错误按项失败，不误判为文件不存在。
- 版本提升至 0.1.2，供桌面交付区分。

## Verification

- `npm run typecheck`：PASS。
- Node 22.23.1 针对性测试：PASS，2 个测试文件、17 项测试。
- Node 22.23.1 全量测试：PASS，48 个测试文件、498 项测试。
- `npm run build`：PASS。
- Electron/Windows 打包与桌面快捷方式启动验证：PENDING。
- 真实 CloudDrive2 + 115：NOT RUN；本轮不读取或搬运用户凭据。

## Risks and follow-up

- 实际速度主要取决于不同父目录数量、CloudDrive 服务响应和本地/NAS 延迟；请求规模已从文件数量降为目录数量。
- 可访问性复查只确认“能否访问”，可访问文件仍需单独执行“分析元数据”才能完成 FFprobe 元数据修复。
- 安装包为未签名测试构建，正式发布仍需代码签名。
