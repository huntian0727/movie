# 正式绿色版发布

## Context

维护者明确授权当前预览版 Windows 沙盒完成正式版测试与发布；替代此前稳定系统要求，已有 beta 发布和测试保留。开发前快照 2026-10-13_05-37-28-629_stable-portable-release；维护清理已验证最新三份快照与数据库后执行。

## Changes

版本 0.1.15；现有正式审批批准仅 unsigned-public-release/source pair 的绿色 ZIP，绑定版本、依赖、源码审批和实际沙盒证据；NSIS/签名/旧身份升级不获本次批准。正式私有草稿支持精确配对源码后云端上传，最终发布需独立成品复核。公开 beta 审批作为历史版本保留。

## Verification

本轮本机实际运行 lint、typecheck、test（140 files / 1,292 tests 全通过）、build、Electron smoke、65 个 media candidate contract 和 native-source Python（12+10+6）检查全部成功。当前正式审批与真实固定源码/运行库的本机预检通过。E2E 脚本不存在，不适用。

发行代码 `092cb79f018693ffa3b69e39408ccc44b66d7688` 的 [Windows CI](https://github.com/huntian0727/movie/actions/runs/38353482272)、[Security audit](https://github.com/huntian0727/movie/actions/runs/38353482266) 与 [source community ZIP](https://github.com/huntian0727/movie/actions/runs/38353583468) 均成功。最终 ZIP 239 个文件，17 份许可逐字节对应精确应用源码，39 个原生 PE 与之前人耳确认包一致；Electron ffmpeg.dll 与 beta 成品相同；实际 Windows 文件版本 0.1.15、产品版本 0.1.15.0，应用与 NativeHost 明确 NotSigned。成品 create/reopen smoke 通过，负向 IPC 拒绝输出是预期检查。

最终 ZIP 在现有沙盒 `C:\MovieQAInput\StableProgram` 实际启动，保留 10 视频、2 目录、1 收藏、7 历史，扫描失败为 0。H.264/AAC 120 秒片有活动画面，暂停 102 秒、跳转 30 秒、恢复到 32 秒；真实 2560×1440 H.265 通过内嵌解码，跳转 86 秒、恢复 89 秒、暂停 98 秒且两次观察不变。退出重开后资料库计数保持、真实视频从已保存位置继续至 107 秒；最终暂停在 119 秒。没有重复声称新的听测，复用相同运行库的既有声音确认。沙盒及原媒体保留，未发布真实视频、截图或资料库。

GitHub Release 发布前后均核对全部 8 个资产的大小和 SHA-256、不可变 v0.1.15 标签对应 commit；无认证访问下载页 200、程序和两份对应源码 HEAD 成功、公开 SHA256SUMS 字节一致，私有输入草稿及资产仍返回 404。Latest 指向本次正式 Release。

## Risks and follow-up

系统真实为 Insider Preview，按维护者最新选择接受；标准用户、正式 NSIS、签名升级、4K/HDR、长时压力未覆盖。日常旧桌面程序未替换，本次交付为已实际运行的正式绿色 ZIP；沙盒外原快捷方式的桌面版本尚未交付，不代表沙盒验收或 GitHub 发布未完成。

旧 Windows Release 工作流 [38353541292](https://github.com/huntian0727/movie/actions/runs/38353541292) 的隔离 NSIS 在生成后因打包器自动发布并缺少 GH_TOKEN 而失败，安装/卸载 smoke 未运行，不记为通过。本次正式绿色 ZIP 的独立工作流完整成功。打包器已明确设置 `--publish never`，保持上传和正式公开为验证后独立步骤；修复后 4 文件 / 87 项发布边界测试通过，本机模拟 CI 标签条件、无任何发布令牌的隔离 NSIS 构建实际通过（exit=0），没有尝试公开且无需 GH_TOKEN。没有给打包步骤注入令牌或改写既有版本标签。

## Published result

[拉面影视 0.1.15](https://github.com/huntian0727/movie/releases/tag/v0.1.15) 于 2026-10-13 14:22:42（Asia/Shanghai）公开，release id 411319692，draft=false、prerelease=false，已设为 Latest。程序 `Movie-0.1.15-Windows-x64-Portable.zip`，214,740,659 字节，SHA-256 `43cc12d78b680d40b03086351d5c7457160a0fa70a8e2beb5c225853a1b61c0d`。程序、精确应用源码、固定原生对应源码及审阅基准、SOURCE-PAIR、构建元数据、最终验收记录和校验和共 8 资产。应用源码 SHA-256 `3843e49c0484ea343e9c525a5654dc9bda2f4db241854c796c0f08e711d87354`。

本机交付材料 `D:\CodexReleaseAudit\movie-stable-0.1.15`。程序运行文件为其 ZIP 解压后的 `拉面影视-免费分享版.exe`；沙盒已打开 `C:\MovieQAInput\StableProgram\拉面影视-免费分享版.exe`。发布产品仍绑定 092cb79，之后的打包器发布隔离修复仅用于后续构建。
