# 架构决策索引

本目录记录仍影响当前维护方式的重要决策。完整系统结构见根目录 `ARCHITECTURE.md`；历史计划不能替代当前决策。

| 决策 | 结论 |
| --- | --- |
| `ADR-001-local-media-source-of-truth.md` | 源视频是事实源，SQLite 是索引，缓存可重建 |
| `ADR-002-low-bandwidth-duplicates.md` | 重复候选使用缓存的精确大小+时长；永久删除前必须完成不可绕过的完整 SHA-256 验证并重检文件版本 |
| `ADR-003-main-delivery-and-backup.md` | 每次合格交付先存档旧 main，再普通快进更新 main，禁止强推 |
| `ADR-004-desktop-only-product.md` | 取消独立 Web/demo 模式，React/Vite 只作为 Electron Renderer |
| `ADR-005-codec-aware-playback-routing.md` | 自动播放路由使用已缓存 codec；历史数据只在首次播放时懒补全，禁止启动全库回填 |
