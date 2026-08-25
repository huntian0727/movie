---
date: 2026-08-25
branch: ai/clouddrive-api-library
type: feat
status: completed
---

# CloudDrive API 资料来源

## Context

旧资料库通过挂载盘路径扫描后再补绑远端身份，失效目录会持续失败。产品决定改为在添加目录时直接通过 CloudDrive API 建立权威远端索引，数据库保存远端身份、路径和扫描快照；本地/NAS 来源保持原行为。

## Changes

- 新增 CloudDrive API 目录浏览与添加 IPC，Renderer 只能传挂载点和远端目录选择，Token 仍留在 Main Process。
- 新增网盘目录选择器，支持浏览已挂载来源、远端子目录、当前层视频统计，并在添加后自动启动扫描。
- API 来源同时保存本地挂载播放路径和远端 provider 根路径；扫描继续使用 `GetSubFiles` 的远端 ID、路径、大小和修改时间，不逐视频 `fs.stat()`。
- 显式 API 来源在 CloudDrive 不可用时停止扫描并保留已有索引，不退回慢速挂载盘扫描，不执行缺失对账。
- 沿用按大小预筛的元数据策略：CloudDrive 视频只有形成同大小候选后才进入 FFprobe 时长队列。
- 本地文件夹、NAS/SMB、现有数据库路径、播放和文件管理行为保持不变。

## Verification

- 固定 Node 22.23.1 / npm 10.9.8 `npm run test:release-gate`：PASS；50 个测试文件、514 项测试全部通过。
- 定向 CloudDrive/数据库/IPC/Renderer 验证：PASS；8 个测试文件、129 项测试。
- `npm run typecheck`：PASS。
- `npm run verify:artifact`：PASS；3958 个 asar 条目，无禁止的开发文件。
- `npm run test:packaged-smoke`：PASS；打包启动、数据库、协议、Renderer、Preload、CSP 和 FFmpeg/FFprobe 验证通过。
- Windows 目录包：PASS；从 `C:\Users\test\Desktop\Video Manager (Dev).lnk` 启动后，主界面显示“通过 API 添加网盘目录”，真实 CloudDrive2 配置成功列出 `/115` 的 64 个子目录和当前层 3 个视频文件。为避免修改用户资料库，验收在“添加并扫描此目录”前取消。

## Risks and follow-up

- 当前只列出已挂载的 CloudDrive 来源，因为播放、FFprobe 和现有缓存链路仍需要本地挂载路径；纯远端未挂载播放属于后续原生播放阶段。
- CloudDrive API 未提供可靠视频时长；同大小候选的 FFprobe 仍会读取少量挂载盘媒体数据。
- 旧资料库兼容绑定保留为补救工具，但不再是新资料来源的主流程。
