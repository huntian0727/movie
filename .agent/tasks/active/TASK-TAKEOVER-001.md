# Task Packet

- Task ID: `TASK-TAKEOVER-001`
- Title: 接管并修正扫描异常与 CloudDrive 批量处理
- Workflow: `FULL`
- Risk Areas: `UI / CROSS_LAYER / DATA / FILESYSTEM / IRREVERSIBLE / CLOUDDRIVE / CONCURRENCY / RELEASE`
- QA Required: `YES`
- UI Required: `YES`
- Web Advisor Required: `NO`
- Workflow Reason: 涉及批量永久删除、远端缺失判定、CloudDrive 核心长流与预取、跨进程任务状态和桌面交付。
- Owner: Local Project Manager / Developer
- User Goal: 只处理两类异常：确认损坏且无法播放的文件永久删除；网盘已删除的文件仅清理本地失效记录。批量重新检查与元数据分析拆分，支持全筛选选择、进度和取消；重复项单文件直接删除。
- Scope: 在最新 main 上选择性迁移可用改动，统一主进程安全规则，修正 CloudDrive gRPC/挂载/预取，恢复精确刷新并完成自动化与真实 115 验证准备。
- Out of Scope: CloudDrive 原生播放 URL、PushMessage 增量同步、CloudDrive 原生文件 RPC、签名正式 Release。
- Acceptance: 离线/失败/取消不清理记录；远端缺失经在线父目录强制刷新确认；损坏删除只接受明确证据和版本复查；全筛选任务可进度/取消；批量重新检查不跑 ffprobe；本地/NAS 行为不回归。
- Automated Tests: focused scan-failure/CloudDrive/IPC/renderer tests, typecheck, build, full Node release gate, Electron/package smoke in isolated ABI checkout.
- Status: `COMPLETED`
- Next Actor: User validation on the configured real CloudDrive2 + 115 mount
