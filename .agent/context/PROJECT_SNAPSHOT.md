# PROJECT SNAPSHOT

> PM 维护的低成本上下文缓存，不是事实源。冲突时按：当前代码 > migrations > tests > Git > 最新正式文档 > 本快照。通常每 10–20 个任务或里程碑结束时压缩一次。

映匣是 Windows Electron 本地视频资料库，技术栈为 Electron 33、React 18、TypeScript 5.7、Vite 6、better-sqlite3。源视频位于本地磁盘、映射盘或网络目录；SQLite 保存索引和状态，封面/时间轴为可重建缓存。Renderer 不直接访问 Node、磁盘或数据库，只通过 sandboxed preload 和校验后的 IPC 调用主进程。工具链固定 Node 22.23.1、npm 10.9.8；Node 与 Electron native ABI 必须隔离验证。

核心链路：`renderer → preload/IPC → service/repository → SQLite/文件系统/FFprobe/播放器`。当前 schema 为 v10，只允许追加 migration。扫描必须在目录完整可用时才能进行 missing 对账；网络失败、离线、超时、取消不能清除有效索引。播放采用 native → mpv → 系统默认 fallback，并依据缓存的容器/codec/probe 状态保守路由。CloudDrive2 仅完成 Phase 1 挂载点发现与 gRPC 枚举加速，原生播放和文件操作尚未实施。

当前产品决定：重复候选按缓存的精确大小和时长发现，浏览不读取完整文件；用户已明确选择效率优先的一键永久删除候选移除项，接受内容误判风险。专用快速通道仍须由主进程按 ID 校验候选组、保留项和“每组只保留一个”；通用删除与扫描异常入口不能借此绕过各自 guard。历史 SHA-256 两阶段流程保留为可选安全模式。优先保留目录包含其所有子目录。

高风险边界：永久/批量用户文件动作、数据迁移、播放架构、CloudDrive 核心、安装发布、安全/并发与重大 UI 改版一律 FULL；不能为省 Token 降低正确性。真实 SMB 断线、映射盘语义、旧库实物升级、ACL/锁/磁盘满/跨卷、多格式媒体、干净 VM 与签名安装仍缺完整实机证据。

导航优先用 `docs/ai/CODE_MAP.md`；活风险看 `docs/ai/KNOWN_RISKS.md`。日常任务先读本快照、当前 task、角色规则和相关 handoff，再查 3–8 个相关代码/测试文件。Git、测试、handoff 与状态事实优先由 `scripts/agent/` 脚本生成，Agent 只解释影响。
