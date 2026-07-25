[OPEN] video-frame-crop

# Debug Session: video-frame-crop

## Symptom
- 部分视频播放时无法显示完整画面。
- 同一批视频的封面和时间轴预览图也存在不完整问题。

## Expected
- 播放器应完整显示视频画面，不裁切、不误缩放。
- 封面和时间轴预览图应完整显示同一画面比例。

## Hypotheses
1. 播放器运行时拿到的实际视频尺寸与数据库元数据不一致。
2. 视频存在旋转/显示矩阵元数据，当前元数据提取未正确归一化宽高。
3. FFmpeg 抽帧链路在部分视频上使用了错误缩放/输出尺寸。
4. Electron `<video>` 对部分编码视频的渲染尺寸异常，需要运行时证据确认。
5. 封面/时间轴图已经重新生成，但 `local-video://` 图片响应被长期缓存，renderer 继续显示旧图。
6. Renderer 中缩略图/预览图的承载容器仍固定为 16:9，虽然文件本身完整，但实际显示尺寸或覆盖层让用户看起来像“显示不全”。

## Plan
1. 为元数据提取、抽帧、播放器渲染增加最小化调试上报。
2. 让用户复现问题，收集 pre-fix 日志。
3. 根据证据确认根因后再做最小修复。
4. 进行 post-fix 验证并等待用户确认。

## Evidence
- `trae-debug-log-video-frame-crop.ndjson:1`
  - path=`<sample-drive>\sample-library\sample-video.mp4`
  - metadataWidth/Height=`720x1280`
  - videoWidth/Height=`720x1280`
  - clientWidth/Height=`720x1280`
- `dist-main/main/media/mediaProtocol.js`
  - 仍然是旧逻辑：`Cache-Control: public, max-age=31536000, immutable`
  - `ensureCover()` / `ensureTimelineFrame()` 仍未调用 repository 回写数据库状态
- `dist-main/main/db/videoRepository.js`
  - 仍然缺少 `markThumbnailReady` / `markTimelinePreviewReady`
- `library.sqlite`（复制后查询样本 `<sample-drive>\sample-library\sample-video.mp4`）
  - `thumbnail_status = pending`
  - `timeline_preview_status = pending`
  - `cover_cache_path = null`
  - `timeline_previews` 对应记录为空
- `trae-debug-log-video-frame-crop.ndjson`
  - 样本 `<sample-drive>\sample-library\sample-video.mp4`
  - `naturalWidth/Height = 480x853`
  - `coverWidth/Height = 232x130.5`
  - `renderedWidth/Height = 232x412`
  - 说明封面文件本身完整，但固定 `16:9` 的封面容器太矮，图片被容器裁切。
- 结论：
  - 假设 1 否定：数据库元数据与播放器运行时尺寸一致。
  - 假设 2 否定：样本未体现旋转后尺寸错乱。
  - 假设 4 成立：播放器元素按原始竖屏尺寸渲染，超过播放窗口舞台高度，导致画面被裁切。
  - 假设 5 部分成立，但更上游的根因已确认：桌面端启动时使用的是未重新编译的 `dist-main` 旧主进程代码，导致最新的缓存失效策略和数据库回写逻辑没有真正生效。
  - 假设 6 成立：封面和时间轴预览在 renderer 仍被固定 `16:9` 展示框约束，竖屏图片因此看起来“显示不全”。

## Fix
- 将 `.player-stage video` 恢复为 `width: 100%; height: 100%; object-fit: contain;`
- 增加 `min-width: 0; min-height: 0;`，确保在 grid 布局下也按舞台尺寸缩放。
- 将 `local-video://cover` / `local-video://preview` 的图片响应缓存策略改为 `no-store`，避免 renderer 继续命中旧的裁切图。
- 在图片生成成功后回写 `thumbnail_status`、`timeline_preview_status` 和 `cover_cache_path`，让数据库状态与实际缓存文件一致。
- 在 renderer 侧为封面和时间轴预览 URL 增加版本参数，强制现有界面请求新图而不是沿用旧缓存键。
- 将视频库封面卡片和播放器时间轴预览从固定 `16:9` 改为按视频真实宽高比展示，避免竖屏缩略图被容器裁掉。
