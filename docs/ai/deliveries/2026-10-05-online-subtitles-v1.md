---
date: 2026-10-05
branch: ai/online-subtitles-v1
type: feat
status: source-and-desktop-acceptance-complete
---

# 在线字幕查找与播放 V1

## Context

用户要求从外部平台获取已有字幕，并授权开发。本轮实现主动查找、选择和下载字幕，不生成字幕。Workflow FULL，独立 QA/UI 记录在 `.agent/handoffs/ONLINE-SUBTITLES-V1-*.json`。全部时间按 Asia/Shanghai。

- 基线 `82efc99c4813568eaba64acf12e082e6df1a41b2`，开发前工作区干净。
- 完整备份 `2026-10-05_10-12-26-522_online-subtitles-v1`，含源码 bundle、SQLite 一致性快照、设置和 manifest；数据库 quick_check 通过，345479 条视频记录。
- 已推送检查点 `checkpoint-20261005-181222-82efc99-online-subtitles-v1`。
- 独立审查的实现提交 `9480d87d7aedb4a2ba8ba01ce3845ca6aeb62192`；随后交付提交只增加任务/审查/本记录，不改变实现。

## Changes

- 接入官方 ASSRT/OpenSubtitles API。设置页配置 Token/API Key 和按需下载账户，Electron safeStorage 加密保存；无明文回读或明文降级。
- 播放器“字幕”入口可编辑片名/发行版本，选择中文、双语、英文和来源，候选展示来源与匹配线索；未配置、服务失败、空结果分别呈现。
- 支持直接 SRT、ASS/SSA、VTT 文件，验证时间轴并统一编码；限制网络超时、大小、并发、官方 HTTPS/CDN 主机，每次重定向重新校验，不发送 API 凭据到 CDN。Renderer 只能提交 ID 与有限参数，不能提交下载 URL/路径。
- 字幕在用户目录独立保存并关联视频文件版本，重启自动加载，清理封面缓存不删除。支持关闭/选择、时间偏移与导出；源视频与数据库结构不变。
- MPV 保留原 ASS 样式，Chromium 转文本 VTT，外部播放器导出后手动加载。字幕失败独立提示，不中断视频。
- 完整接线 shared/preload/IPC/role policy，账号写入限主窗口；旧会话与旧视频响应隔离。弹窗隐藏原生窗口/预览并支持 Escape、焦点恢复与焦点约束。
- 独立 QA/UI 发现的关闭弹窗丢失下载结果、过长元数据导致 manifest 不可读、旧 token 错误、预览覆盖弹窗和记录读取失败无恢复提示均已修复并复核。
- 修改 main/subtitles、shared、IPC/播放服务、NativeHost、renderer 设置/播放器、相关测试与模块 README；不修改扫描、CloudDrive 或文件删除业务。

## Verification

- `test:release-gate`：PASS，固定 Node 22.23.1；lint/typecheck/build、Windows 路径 37 项、迁移 32 项、性能 31 项、111 个测试文件 / 964 项。日志 `.tmp/subtitle-final-gate.log`。
- 独立 QA：6 个定向文件 / 60 项和 2 个临时对抗文件 / 4 项通过，PASS_WITH_KNOWN_RISKS。独立 UI：源码交互复核、9 项 Renderer 测试及两张真实桌面截图检查通过，UI_REVIEW_PASS。桌面操作由 root 执行，截图由 UI 独立复核。
- 隔离 checkout 的 Electron ABI 130：Electron smoke、`package:dir`、`verify:artifact` PASS；打包 smoke 在候选包通过，交付文档提交后对最终重建包再执行。开发工作区 Node SQLite ABI 未被 Electron 覆盖。
- 实际 Electron safeStorage + NativeHost/MPV 隔离运行 PASS：生成视频与 ASS、模拟提供方验证真实 MPV 选中 ASS、1.5 秒偏移确认、关闭/重选、暂停保持及服务重新实例化后的持久化；不等同于网站认证下载。
- 真实桌面快捷方式 `C:/Users/test/Desktop/拉面影视.lnk` 指向 `C:/Users/test/Documents/视频管理/movie/release/win-unpacked/拉面影视.exe`。从原快捷方式启动新候选包，资产中心正常，设置 → 在线字幕可见；实际内嵌播放字幕面板搜索分别提示两个来源需配置；弹窗隐藏原生视频，Escape 关闭后视频、暂停与焦点恢复。
- 审查截图在忽略目录 `.tmp/subtitle-ui-evidence/`，不上传真实媒体截图；未保存/修改用户字幕平台账户。
- `git diff --check` PASS；通过 `finish-and-push.ps1 -SkipChecks` 正常推送功能分支与 main，更新前备份 main。SkipChecks 依据同工作区已完整执行的等价发布门禁；最终提交和备份标签以脚本 RESULT 及 Git 远程核对为准。
- 交付原快捷方式指向的 unpacked 桌面程序。本记录提交后重新构建最终包、验证产物/打包 smoke、部署并从原快捷方式复核，比较 Commit 和 app.asar 时间/哈希。最终证明在忽略目录 `.tmp/final-subtitle-desktop-proof.json` 并在最终回复报告；不生成或声称更新 NSIS 安装器。

## Risks and follow-up

- 真实认证搜索/下载 **NOT RUN**：缺少用户自己的平台凭据；账户配额、真实 CDN 和可用性需配置后实测。模拟与 MPV 测试不能替代该项。
- Chromium ASS 只显示基本文本；MPV 保留样式；不支持压缩包、图像字幕和附带字体；外部播放器需手动加载导出文件。
- 匹配分仅为排序参考，用户应核对发行版本，必要时调整偏移；在线服务条款与配额可能变化。
- 初次全局 Node 24 门禁遇到 ABI 不匹配，固定 Node 22 并重建 SQLite 后最终完整门禁通过；Electron 使用隔离依赖。未降低测试或修改产品来规避检查。
- 窄屏实机专项未测；截图窗口适配与滚动已检查。
- 回滚使用检查点或新 revert 分支正常交付，不强制倒退 main；数据恢复使用完整快照，避免覆盖正在运行的数据库。
