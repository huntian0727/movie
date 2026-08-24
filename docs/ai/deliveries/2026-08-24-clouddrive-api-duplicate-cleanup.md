---
date: 2026-08-24
branch: ai/clouddrive-api-duplicate-cleanup
type: feat
status: completed
---

# CloudDrive API 重复文件批量清理

## Context

大规模网盘视频通过挂载盘逐文件访问时速度慢、带宽开销高。此次按已确认的效率优先方案，将重复候选判定改为“精确大小 + 四舍五入整秒时长”，并为 CloudDrive 候选提供不读取文件内容、不计算 SHA-256 的持久化 API 批量删除链路。优先保留目录需要支持多条规则、包含全部子目录并作用于全部筛选结果，而不是仅当前页。

## Changes

- 新增数据库 v11 迁移，持久化 CloudDrive 来源、远端文件 ID/路径、时长来源、API 删除任务字段及多条优先保留目录规则。
- CloudDrive 扫描保存稳定远端身份，目录列表提供 24 小时进程内缓存；普通扫描复用缓存，显式当前目录扫描强制刷新。云端 FFprobe 只调度同大小碰撞候选，本地/NAS 行为保持原样。
- 重复组按文件大小与四舍五入整秒时长聚合。多条优先目录及其子目录中的文件受保护；本地、NAS、SMB 文件只参与比较或保留，不进入自动 API 删除。
- 新增“全部筛选结果”服务端流式计划生成，不依赖当前分页。持久化 workflow v3 删除任务支持重启恢复、取消、8 路并发、100 项请求批次、失败批次递归隔离和删除前远端身份/版本复查。
- gRPC 客户端实现 `DeleteFilesPermanently`。服务器不支持永久删除时回退 `DeleteFiles`，将结果标记为进入网盘回收站且不计已释放空间。
- 重复项界面支持持久化的多优先目录列表及移除操作，并提供“批量删除全部筛选结果”按钮；历史 SHA-256 任务仅保留兼容读取与旧调用路径，不再作为当前 CloudDrive UI 流程。

## Verification

- `npm run typecheck`（Node 22.23.1 / npm 10.9.8）：PASS。
- `npm test`：PASS，48 个测试文件、501 项测试全部通过。
- 新增回归覆盖：永久删除 RPC 方法与远端路径编码、整秒时长分组、多优先目录保护、全部筛选计划、API 删除零哈希读取、持久化任务状态。
- `npm run package:dir`：PASS；已生成 `release/win-unpacked/Local Video Manager.exe`。
- `npm run verify:artifact`：PASS；ASAR 共校验 3957 个条目。
- `npm run test:packaged-smoke`：PASS；创建、验证和安全负向检查全部通过，负向检查中的 `ERR_UNTRUSTED_IPC_SENDER` 为预期结果。
- 真实 CloudDrive2 账号端到端删除：NOT RUN；自动测试使用本地 HTTP/2 gRPC 仿真服务，桌面人工验证不执行真实删除。
- 桌面快捷方式人工验证：PASS；`C:\Users\test\Desktop\Video Manager (Dev).lnk` 已指向本次 `release/win-unpacked` 构建。实机启动后重复项页显示 13790 组，并确认“添加优先保留目录”“优先保留此目录”“批量删除全部筛选结果（13790 组）”和“后台任务”入口均存在，同时页面明确提示不计算 SHA-256。现有候选来自旧挂载资料库、缺少 CloudDrive 远端身份，因此批量 API 删除按钮按设计禁用；人工验证未执行任何真实文件删除。

## Risks and follow-up

- 重复判定是用户明确接受的近似规则，不做内容校验；大小与整秒时长相同但内容不同的文件仍可能被当作重复项。
- 24 小时 CloudDrive 目录缓存当前为进程内缓存，重启应用后会重新从 API 获取；如需跨重启缓存，可在后续版本将目录快照正文持久化。
- CloudDrive 实际部署若修改 protobuf 字段或禁用两种删除 RPC，任务会逐项失败并保留数据库记录，需结合真实服务器日志适配。
