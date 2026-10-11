# Traceable shared media runtime

## Context

继续 GitHub 发布收尾；上一轮已完成新动态播放器源码留存和本机画面、AAC/DTS/Opus 验证。本轮接入同一次原生构建已产出的 FFmpeg/FFprobe，避免应用继续使用另一路尚未完成静态重链接审阅的 Lite CLI。开发基准 7573481；独立分支 ai/traceable-media-runtime。

开发前快照 2026-10-11_16-07-44-958_traceable-media-runtime，Git checkpoint checkpoint-20261012-000739-7573481-traceable-media-runtime 已推送。维护脚本验证保留的三个开发快照及三个迁移备份后删除一份旧开发快照，Errors=0，未触碰视频或当前资料库。

## Changes

- 增加显式 source-candidate 媒体变体，默认 BtbN/Lite 路线不变，独立暂存目录 .tmp/native-source-media-tools。
- 从原始候选 ZIP 3b4b4d22a3cf303b05898dedd470a6f05b0bfaa532c4ca9ab481167cd8f21b99 中选取 FFmpeg、FFprobe 与实际导入闭包的 12 个 DLL。所有共用 DLL 与播放器锁的 SHA 相等；不重新编译，不覆盖旧运行库。
- 新锁保存 14 个实际 PE 文件的 SHA/导入关系、生产任务和原始源码证据 SHA；补齐 FFmpeg 原始 COPYING.LGPLv2.1 和候选状态通知。
- 准备、打包、实际包及 ZIP 验证支持这一变体，记录媒体锁 SHA，核验每个文件、通知、x64 架构并拒绝未知附加文件。正式发行保持阻断，不改 approved/manualQaApproved/sourceComplianceApproved。
- 源码清单补充 includedInSourceMediaQa，说明媒体/播放器均能选择同一来源。完整通知比对从 11 项扩为 12 项。
- 两份原生锁和审阅 JSON 固定 LF，避免 Windows 换行转换改变哈希。新源码审阅附件 release/native-source-media-review-20261012-lf/Native-Source-Review-38134981406.zip，255221205 字节，SHA 321019ed520fa6ea7aebaff0a0ff20d8f4b9f2efb68e7a14b2ea956e84365e50。包含原始完整源码证据、原始 map、两份锁、恢复入口和现有完整通知；未上传。

## Verification

- 实际新媒体工具通过五份中性样片及一份真实 2560×1440 HEVC/PCM A-law 视频的 ffprobe 元数据、应用 generateCover/generateTimelineFrame 两种取帧路径和快速取帧验证；18 份 JPEG 非空且格式有效。源视频只读，输出在忽略目录。
- 新增三项回归覆盖隔离身份、正式发布阻断、共享依赖 SHA、许可证 SHA、额外 DLL、篡改、缺失、x86、路径逃逸及错误 ZIP。
- 初次完整测试 1205 通过/4 失败：临时执行器把 MOVIE_PLAYER_VARIANT=source-candidate 强加到模拟旧正式发行的夹具，被现有正式门禁拒绝。修正临时测试执行器，不改变门禁；针对发行/新媒体的 29 项测试通过。完整回归重跑 135 文件/1209 项全部通过。
- 锁定 Node 22.23.1/npm 10.9.8：lint、typecheck、build、Electron smoke PASS；媒体契约 65/65、新源码构建 Python 12/12 PASS。finish-and-push ValidateOnly 与 git diff --check PASS。
- 从本轮代码提交 6a0abef13d493f49a8e849b2efd39bb93326670f 的干净工作区生成新绿色候选包：release/unsigned-test-build/拉面影视-0.1.15-x64-unsigned-test-build-Portable.zip，212829369 字节，SHA f4707f867e6fbd4a2d0090612e15c65ed1d89fe9d6e1bbb0ace68222afba6d47。
- 包内 mediaVariant/playerRuntimeVariant 均为 source-candidate，workspaceDirty=false。媒体锁 SHA 70ab4dac7dfe6c433f26802861f5e1f3b76dcd8997cd2cd313e209a9f2e17fa5；播放器锁 SHA 11ad832489dabf095b9d06bb0c6011e8144905a5eeac25d69b24c2f76aac532f。
- verify:zip PASS：portable-qa-vL3YDv 的 221 文件逐字节相等；12 份许可材料匹配；实际程序创建/重开资料库、扫描、缩略图生成/Renderer 解码、缓存重生成、工作线程和 IPC/CSP 防护 smoke PASS。应用及 NativeHost 明确 NotSigned，publicReleaseApproved=false。
- 使用解压包 resources/media-tools 的两个 CLI，再次对六份视频执行应用实际封面、普通时间轴和快速取帧路径，全部 PASS。app.asar SHA 保持 b2108a29622c7e142ca3985a57d08bfe0366dc8ffcd41cadbc7be6c788705ab4，播放器全部 24 DLL 字节保持上一轮验证结果；没有把新媒体工具声称为新的播放器听音验证。
- 检查三个桌面快捷方式真实目标：日常指向 release/win-unpacked/拉面影视.exe，绿色测试指向旧 portable-qa-nLMQRi，发布验收指向 D:/CodexReleaseAudit 下旧包。本轮未替换或从这些旧快捷方式启动；桌面版本尚未交付。新版隔离包的实际启动由上述包内 smoke 完成。
- 独立 E2E npm 脚本不存在，记为不适用。

## Risks and follow-up

- 此轮完成统一媒体工具的私有验收接入。正式配置仍需支持这套原生材料的准确审批记录、全部 DLL 和可复用输入取得流程；不能用现有旧四项二进制记录批准新包。
- 第三方及嵌套静态组件适用性审核、稳定 Windows 11 正式身份验收与最终公开版本授权尚未完成。原始生产任务整体 FAIL 与后续本地系统依赖核验分别保留，不改写历史结论。
- 已确认的新播放器文件未改动，无需重复 AAC/DTS/Opus 人工听音。真实 1440p 新库 PCM 仍无新的人耳确认，不转借旧沙盒确认。
- 现有 Windows 沙盒与真实视频未清空，D200707 尚未访问。日常桌面快捷方式未替换；桌面版本尚未交付。无公开程序、版本 Tag 或 GitHub Release。
- 本轮完整等价检查已在同一工作区执行并记录，代码先本地提交后从干净工作区打包；本记录补充真实包结果，再调用 finish-and-push -SkipChecks 正常推送两次本地提交并备份旧 main，避免为仅文档记录重跑全部测试。
