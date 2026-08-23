# Project State

- Active Task: `none`
- Current Stage: `COMPLETED`
- Current Owner: Local Project Manager
- Branch: `ai/takeover-scan-clouddrive-corrections`
- Current Schema: `10`
- Current Milestone: 扫描异常与 CloudDrive 接管修正
- Open P0: None.
- Live P1: Real SMB/offline mapped-drive semantics, real legacy-database recovery, physical file-operation faults, broad media compatibility, signed installer, and clean-VM release remain incompletely evidenced.
- Product Decision: Duplicate candidates use cached size+duration without reading content. Every permanent duplicate deletion must complete full SHA-256 verification; one-click actions may auto-delete only verified-identical items after final version/content-identity revalidation.
- Scan Failure Decision: 只处理确认损坏文件的永久删除，以及经 CloudDrive 在线父目录强制刷新确认后的本地失效记录清理；其他异常只允许重试。
- Batch Decision: 批量重新检查与元数据分析拆分，支持选择全部筛选结果、进度和取消；重复项单文件删除不弹二次确认。
- Workflow Decision: LITE/STANDARD/FULL is selected by risk; permanent or batch user-data operations are always FULL.
- Machine Facts: `.agent/state/machine-state.json` (regenerate; do not treat cached values as current truth).
- Next Actor: User validates the packaged build against the configured real CloudDrive2 + 115 mount.
