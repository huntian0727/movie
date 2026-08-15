# ADR-005：基于 codec 的保守播放路由

状态：Accepted（当前有效）

## Context

只按扩展名把 MP4/MOV/WebM 交给 Chromium 会把 HEVC、10-bit 或不兼容音轨误判为 native，造成打开后黑屏或失败；但对数万条历史记录启动时全库 FFprobe 会大量读取本地盘和映射网盘，违反低带宽与快速启动目标。

## Decision

1. 在 schema v8 为视频增加 nullable 的视频 codec、profile、pixel format 和音频 codec 字段。
2. 新文件复用既有单次 FFprobe 元数据读取采集这些字段，不增加额外媒体读取。
3. 迁移不回填、不重置 metadata 状态；历史 ready 视频只在首次真正准备播放时探测并持久化。
4. `auto` 仅将明确兼容的组合交给 native，未知/复杂组合使用 mpv；显式 `native-first` 和 `mpv-first` 语义不变。
5. 懒补全失败不得阻塞播放器，且不得记录原始路径或 FFprobe 输出。

## Consequences

- 首次播放历史视频可能增加一次 FFprobe 延迟，后续播放直接使用 SQLite 缓存。
- 网络盘离线或缓慢时仍可能等待单次 probe 的既有超时，但会失败降级且不会改变 metadata ready 状态。
- 保守规则可能把 Chromium 实际可播放的边缘组合交给 mpv；这是安全偏向，后续只能依据真实样本和测试扩展白名单。
