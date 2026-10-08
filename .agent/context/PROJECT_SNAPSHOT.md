# PROJECT SNAPSHOT

> PM 维护的低成本上下文缓存，不是事实源。冲突时按：当前代码 > migrations > tests > Git > 最新正式文档 > 本快照。通常每 10–20 个任务或里程碑结束时压缩一次。

拉面影视是 Windows x64 Electron 本地视频资料库。2026-10-08 发布审计分支从 main 807c495 升级至 Electron44.7.0、Vite8.3.3、better-sqlite3 13.0.3 N-API、Vitest5.0.3；Node22.23.1/npm10.9.8不变。源视频位于本地磁盘、映射盘或网络目录；SQLite保存索引，封面/时间轴为可重建缓存。Renderer用app-ui://bundle、sandboxed typed preload及角色校验IPC，不能直接访问Node/DB。N-API兼容性须分别实际验证，不能使用旧11版binding。审计当前正式发布FAIL，详见 docs/public-release-audit.md。

核心链路：`renderer → preload/IPC → service/repository → SQLite/文件系统/FFprobe/播放器`。当前schema v15，仅追加migration。扫描对账须目录完整可用，网络失败/离线/超时/取消不能清除有效索引。播放采用native/mpv/系统默认fallback，libmpv由用户另装。CloudDrive支持挂载点映射、gRPC流式枚举及API重复候选永久删除；账户绑定、取消/拆批、重启手动恢复已加固。

当前产品行为：CloudDrive快速候选按规范化名称与大小分组，默认metadata fast永久删除不是整文件SHA证明，公众默认/强确认策略待owner决定。旧duplicateFastDelete IPC已拒绝，当前cleanup submit入口及主进程keep/source计划仍须校验。历史SHA两阶段工作流只作兼容保留，不能宣称当前UI有可选安全模式。通用删除/扫描异常均须独立source/reparse/identity守卫。

高风险边界：永久/批量用户文件动作、数据迁移、播放架构、CloudDrive 核心、安装发布、安全/并发与重大 UI 改版一律 FULL；不能为省 Token 降低正确性。真实 SMB 断线、映射盘语义、旧库实物升级、ACL/锁/磁盘满/跨卷、多格式媒体、干净 VM 与签名安装仍缺完整实机证据。

导航优先用 `docs/ai/CODE_MAP.md`；活风险看 `docs/ai/KNOWN_RISKS.md`。日常任务先读本快照、当前 task、角色规则和相关 handoff，再查 3–8 个相关代码/测试文件。Git、测试、handoff 与状态事实优先由 `scripts/agent/` 脚本生成，Agent 只解释影响。
