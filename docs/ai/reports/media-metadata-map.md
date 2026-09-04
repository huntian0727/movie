# 媒体信息数据映射

## 数据采集路径

```text
文件发现 / CloudDrive API listing
  -> size + modified time + provider identity
  -> videos 基础记录（metadata_status=pending）
  -> MetadataQueue（当前实例 concurrency=3）
     -> CloudDrive 重复大小候选：优先 readDuration
     -> 本地/需完整元数据：readMetadata
  -> ffprobe JSON 解析
  -> VideoRepository 按 id + path + size + modifiedAt 版本条件更新
  -> VideoRecord -> IPC -> UI
```

## 已保存数据

| 信息 | 是否保存 | 数据库字段 | `VideoRecord` | 来源/代码 |
| --- | --- | --- | --- | --- |
| 文件大小 | 是 | `videos.size_bytes` | `sizeBytes` | local `fs.stat`；CloudDrive `GetSubFiles.size` |
| 修改时间 | 是 | `videos.modified_at` | `modifiedAt` | local stat mtime；CloudDrive writeTime |
| 导入/更新时间 | 是 | `imported_at` / `updated_at` | `importedAt` / `updatedAt` | repository |
| 容器/格式 | 是 | `format` | `format` | ffprobe `format.format_name` |
| 时长 | 是，可为空 | `duration_ms` | `durationMs` | ffprobe format duration；CloudDrive 候选按需读时长 |
| 时长来源 | 是 | `duration_source` | `durationSource` | unknown/local-probe/clouddrive-api/cached |
| 分辨率 | 是，可为空 | `width` / `height` | `width` / `height` | ffprobe 首个 video stream |
| 视频编码 | 是，可为空 | `video_codec` | `videoCodec` | ffprobe 首个 video stream `codec_name` |
| 视频 profile | 是，可为空 | `video_profile` | `videoProfile` | ffprobe `profile` |
| 像素格式 | 是，可为空 | `pixel_format` | `pixelFormat` | ffprobe `pix_fmt` |
| 音频编码 | 是，只取首音轨 | `audio_codec` | `audioCodec` | ffprobe 首个 audio stream `codec_name` |
| 编码探测状态 | 是 | `codec_probe_status` | `codecProbeStatus` | unprobed/ready/failed |
| 元数据状态 | 是 | `metadata_status` | `metadataStatus` | pending/ready/failed |
| 文件缺失 | 是 | `is_missing` | `isMissing` | 安全 missing reconcile |
| CloudDrive 远程身份 | 是，API 源可用 | `provider_file_id` / `provider_path` | 同名 camelCase | CloudDrive API listing |
| 封面/时间轴状态 | 是 | status/cache path + `timeline_previews` | 部分映射 | FFmpeg 可重建缓存 |
| 快速内容指纹 | 是，为可选历史能力 | `content_fingerprint` 及 status/error/time | 同名 camelCase | `contentFingerprint.ts`；不是完整 ffprobe |

## 尚未保存或未建模的数据

| 信息 | 现状 | 对播放诊断的影响 |
| --- | --- | --- |
| HDR 明确信息 | 未保存 `color_primaries/color_transfer/color_space`、bit depth、mastering display/content light side data | 不能可靠区分 HDR10/HLG/Dolby Vision；`pixelFormat` 只是间接线索 |
| 音轨详情 | 未保存音轨数、channels、layout、sample rate、bit rate、language/default flag | 只能告知首音轨 codec，无法判断多音轨/声道兼容性 |
| 字幕信息 | 完全未建模 | 无法显示字幕流数、编码、语言和内嵌/图形字幕兼容性 |
| 码率/帧率/时基 | 未保存 | 无法解释高码率或 VFR 导致的性能问题 |
| 全部 stream | 只解析首个 video/audio stream | 无法提供完整流列表 |
| ffprobe 原始 JSON | 不保存，也不经 IPC 暴露 | 无法从库中还原完整探测结果；这也避免数据库膨胀和敏感路径外泄 |
| 实际解码能力 | 仅有 `choosePlaybackRoute` 规则表 | 是路由建议，不是 GPU/Chromium/mpv 现场解码成功证明 |
| 播放失败历史 | 无持久化业务记录 | 无法按文件/编码/路由统计失败率 |

## 当前接口与代码位置

- 共享数据型：`src/shared/videoTypes.ts#VideoRecord`。
- 全量元数据读取：`src/main/media/metadataService.ts#readMetadata`。
- 轻量时长读取：`src/main/media/metadataService.ts#readDuration`。
- 后台处理：`src/main/media/metadataQueue.ts#MetadataQueue`。
- 播放前懒补：`src/main/media/playbackMetadataEnricher.ts`。
- 持久化/版本防护：`src/main/db/videoRepository.ts`的 `upsertVideo`、`markMetadataReady`、`updateCodecMetadataIfVersion`。
- 已有 UI：`src/renderer/components/VideoDetailsDialog.tsx`，当前只显示格式、时长、分辨率、大小、路径/时间和系统状态，尚未展示已缓存的 codec/profile/pixel/audio codec。

## 下一阶段建议

1. 播放诊断 V1 首先直接展示现有 `VideoRecord` 字段，不需要数据库迁移。
2. 需要 HDR/字幕/多音轨时，新增按 video ID 运行的可取消详细 ffprobe service，返回类型化摘要；默认不持久化原始 JSON。
3. 按 `path + sizeBytes + modifiedAt` 做内存/可重建文件缓存，避免用户在诊断页重复读网盘。
4. 只有确定需要长期查询、聚合统计或离线查看详细 stream 时，才评审新表；不建议继续向 `videos` 添加大量可空列。
