# 架构决策索引

本目录记录仍影响当前维护方式的重要决策。完整系统结构见根目录 `ARCHITECTURE.md`；历史计划不能替代当前决策。

| 决策 | 结论 |
| --- | --- |
| `ADR-001-local-media-source-of-truth.md` | 源视频是事实源，SQLite 是索引，缓存可重建 |
| `ADR-002-low-bandwidth-duplicates.md` | 已被 ADR-003 取代；保留原完整 SHA-256 安全方案的历史决策 |
| `ADR-003-fast-duplicate-permanent-delete.md` | 历史效率优先方案；无确认的快速永久删除已废止，不得重新启用 |
| `ADR-003-main-delivery-and-backup.md` | 每次合格交付先存档旧 main，再普通快进更新 main，禁止强推 |
| `ADR-004-desktop-only-product.md` | 取消独立 Web/demo 模式，React/Vite 只作为 Electron Renderer |
| `ADR-005-codec-aware-playback-routing.md` | 自动播放路由使用已缓存 codec；历史数据只在首次播放时懒补全，禁止启动全库回填 |
| `ADR-006-size-duration-duplicate-review.md` | 大小与整秒时长判重，不读视频正文、不计算内容哈希；文件版本复查不变，历史快速删除通道仍禁用 |
| `ADR-007-streamlined-manual-duplicate-cleanup.md` | 恢复单项和当前页快捷清理，一次确认后自动安全检查并调用受管文件删除；后台二次确认模式仍可选 |
