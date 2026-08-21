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
6. schema v9 增加 `codec_probe_status = unprobed | ready | failed`。成功探测即为 ready（即使 codec 为空），失败后普通播放不重复探测，文件版本变化后恢复 unprobed。
7. 播放器最多等待懒探测 2 秒；超时只停止等待，后台 FFprobe 继续安全收尾。metadata pending 的常见 native 容器临时 native-first，ready 但 probe 未完成/失败的未知格式继续保守走 mpv。
8. WebM native 白名单要求 VP8/VP9、`yuv420p` 和兼容音轨；10-bit 或未知复杂像素格式走 mpv。

## Consequences

- 首次播放历史视频最多增加 2 秒前台等待；更慢的 FFprobe 在后台继续，后续播放使用 SQLite 状态与缓存。
- 网络盘离线或缓慢不会让播放器等待完整 FFprobe 超时；失败状态持久化且不改变原有 metadata ready 状态。
- 保守规则可能把 Chromium 实际可播放的边缘组合交给 mpv；这是安全偏向，后续只能依据真实样本和测试扩展白名单。
