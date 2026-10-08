# 原生媒体二进制的安全审查

查询日期：2026-10-08，Asia/Shanghai。这是已测二进制版本与上游修复记录的对照，不能被 npm audit 的零项结果替代。

| 输入及实际位置 | 实测版本 | 上游证据及判断 |
| --- | --- | --- |
| ffmpeg-static/ffmpeg.exe；src/main/media/cacheService.ts:19 | FFmpeg 6.1.1 | 官方6.1.2列出CVE-2024-7055等修复，6.1.3还有后续修复。当前版本落后；未取得完整对应源码及补丁证明，不能声称已覆盖这些修复。 |
| ffprobe-static/bin/win32/x64/ffprobe.exe；src/main/media/metadataService.ts:50 | FFprobe 4.0.2 | 官方4.0.3列出CVE-2018-15822，4.0.4/4.0.5还有后续修复。旧构建来源已停止维护，不能仅凭wrapper版本断言二进制安全。 |

来源：[FFmpeg官方安全记录](https://ffmpeg.org/security.html)。以上属于版本和补丁证据的风险判断，没有在本候选上运行恶意媒体POC，不能称这些CVE均已复现、均适用当前配置或已证明可利用。编解码库/静态依赖的完整适用性仍需结合确切源码、启用配置和补丁逐项确认。

**P1：公众发布阻断。** 应将FFmpeg和FFprobe替换为同一套经审查、仍维护的构建输入，同时锁定下载来源、字节hash、启用库、完整对应源码及许可材料；或提交可验证的安全补丁证明。替换后重跑元数据/封面/时间轴、不同格式、原生打包、packaged及installer gates，再更新确切二进制批准hash。不得靠提高npm wrapper版本、增加allowlist或降低hash门禁放行。

本轮候选只以任务生成的合成媒体做安装和工程验收，未获批准向公众分发。项目许可证、GPL对应源码和发布者授权仍由维护者审查；替换来源及其分发材料应与这些决策一并闭环。
