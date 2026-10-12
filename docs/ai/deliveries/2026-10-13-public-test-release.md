# 公开测试版发行

## Context

2026-10-13（北京时间），维护者明确选择“先发布公开测试版，标注验证范围”。首个可用版本目标为 `0.1.15-beta.3` 绿色 ZIP 及对应源码，不提升为稳定版。

## Changes

- 增加准确 beta 版本、单独公开测试版批准和哈希绑定；仅配对 source runtime、GitHub Actions 精确 tag、绿色 ZIP 可用。
- 稳定版批准仍关闭；测试版批准不能生成稳定版、签名包或安装器。
- 固定 39 个原生文件按已审阅组件条款、LGPLv3 later-version 条件收口；源/许可材料随程序同时免费公开。
- 发行说明注明 Insider Preview 沙盒、既有声音验证和未覆盖范围。历史 QA 记录不改写。
- 源码归档工具新增批准后的 beta 对应源码输出，同时保留私有审阅模式。

## Verification

本机 Node 22.23.1 / npm 10.9.8：lint、typecheck、138 文件 / 1261 项完整 Vitest、build、Electron smoke、65 项媒体契约、28 项 Python 原生/源码/许可测试全部通过。新增源码暂存 beta 边界后，重跑受影响的 3 文件 / 70 项测试和 Electron/媒体/Python 检查均通过。首次 Electron smoke 因合成发布身份未处理 beta 失败，已修正并重跑，未跳过检查。E2E 脚本不存在，不适用。

云端最终包、对应源码及 GitHub 公开状态将在发行后补充准确运行号和哈希；本记录当前不把尚未完成的发行检查计为通过。

提交核对发现新 `build/public-test-approval.json` 被既有目录忽略规则排除；补充精确文件的版本控制例外和真实批准文件哈希测试，防止云端缺失该记录。

beta.1 的准确 commit `ff4c378` 主 Windows CI `38286116962`、安全检查 `38286116994` 通过，但源码绿色包构建 `38286168246` 在版本资源校验失败，未公开。实际本机打包复现：FileVersion 字符串为 `0.1.15-beta.1`，固定 PE FileBuildPart 却为 0；打包工具无法把 `15-beta` 作为数字补丁。修复为仅 Windows 文件资源使用 `0.1.15.0`，应用/package/tag 保留完整 beta 语义，不放松版本校验。修复后 3 文件 / 72 项受影响测试通过。

beta.1 tag 保留为失败尝试记录，不改写已有 tag；最终使用 beta.2 tag。已上传的 257 MB 原生对应源码归档可按相同 39 个运行库哈希复用，内部原生批准记录与当前完全一致；归档来自 ff4c378 审阅基线，不伪称其应用代码是 beta.2。同时提供 beta.2 精确应用源代码、基线应用源码和明确 source-pair 映射，产品草稿可改关联新 tag，保留既有源码资产而不重复上传相同运行库资料。

实际重新打包已确认：beta.2 Windows FileVersion 为 0.1.15.0、FileBuildPart=15；package/flavor 仍为 0.1.15-beta.2。新增云端仅草稿暂存步骤，要求精确 beta tag/批准/ZIP smoke、已上传的当前应用源码与固定原生源码 digest、source-pair 的 commit 和原生批准哈希；拒绝公开 Release、稳定版、缺少/变更源码及覆盖不同程序。Actions 仍只暴露元数据/加密包，脚本没有发布或 tag 修改调用。4 文件 / 79 项受影响测试已通过。

## Risks and follow-up

稳定系统、标准用户权限、安装器与签名升级仍未认证。当前公开测试绿色版可下载，旧日常快捷方式保留；不会把此次结果提升为稳定正式版。

## Published result（2026-10-13 02:49:14，北京时间）

已公开 [v0.1.15-beta.3](https://github.com/huntian0727/movie/releases/tag/v0.1.15-beta.3)，Release ID 410861902；`draft=false`、`prerelease=true`、不标 latest。远程 tag 精确指向 `ada4b0bf26d599560add3707a4db0032ec73908a`，8 个资产全部核对 GitHub digest/大小与本机文件；私有原生输入 draft 409795833 继续私有。

- 程序：`Movie-0.1.15-beta.3-Windows-x64-Portable.zip`，214738287 字节，SHA256 `4a5dc896f2bde2563bb7db2ed541c2adc1f07c272c76f790d415b48d53757f25`。
- 准确应用源码：`Movie-0.1.15-beta.3-Application-Sources.zip`，SHA256 `c88762a41e4afbdf55c4be873e4cfa038b4aaa8aa325b7a62e246afe3bce67f0`。
- 不变原生对应源码：`Movie-Native-Runtime-38134981406-Corresponding-Sources.zip`，SHA256 `d7f286b7af10be3f07ca7e13ca7514c24ec15b0d742a673e3f1935e421c3fd75`；旧 beta.1 应用源码仅作为该原生审阅基线，另附 SOURCE-PAIR.json 区分。
- 另外提供 SHA256SUMS.txt、build-metadata.json、RELEASE-VERIFICATION.json；精确来源/范围在公开发行说明中。

最终 tag 的 [Windows CI 38289790024](https://github.com/huntian0727/movie/actions/runs/38289790024)、[安全检查 38289790147](https://github.com/huntian0727/movie/actions/runs/38289790147)、[绿色包工作流 38289848015](https://github.com/huntian0727/movie/actions/runs/38289848015) 全部成功。完整 Vitest 为 139 文件 / 1274 项，通过 65 项媒体契约、28 项 Python 测试及 Electron/Renderer 安全 smoke。该主 CI 的 NSIS 任务为 SKIPPED，不计作新安装器验收。

本机下载同一 ZIP：解压 237 文件、17 份许可原文字节核对、39 个原生 PE 与此前听测包一致、Windows 文件/产品版本资源 0.1.15.0（patch=15）、应用与 NativeHost 均 NotSigned、create/reopen 实际 packaged smoke 均通过。最终包整目录复制到已有沙盒映射，237 文件全部再次核对。沙盒实际启动保留 10 视频/2 来源/1 收藏/7 历史，真实 2560×1440 H.265 原生画面显示，继续播放从 06:56 至 06:59 并观察运动，随后在 07:30 暂停。没有重启沙盒或改动源视频；声音证据只复用不变的 39 个原生哈希，没有声称本轮重新完成整套人耳验收。

匿名公共页面 200、程序/两份准确源码下载 HEAD 成功、公开 SHA256SUMS 原文字节一致。共享出口的匿名 API 曾触发 403 配额，改用匿名网页/资产实测与已认证 API 核验状态；私有输入 draft 页面及资产匿名 404，稳定 latest API 已认证查询 404。

GitHub 上传移除了中文资产前缀，最终下载文件改为 ASCII Movie 名称，同一 ZIP SHA 未变；包内中文 EXE/社区资料库身份保留。后续暂存工具采用 ASCII transport 名称，并拒绝覆盖不同文件；修正后的 4 文件 / 81 项受影响测试通过，未改当前发行 tag 或软件字节。

本地交付资料目录：`D:\CodexReleaseAudit\movie-public-test-0.1.15-beta.3`。本机旧日常快捷方式未切换；**桌面版本尚未交付**。此次成果是已公开的绿色测试发行及沙盒验收，稳定系统/标准用户/安装器/签名升级/4K/HDR 仍未认证。

上传预检实际确认 GitHub REST 的 release-by-tag 对私人草稿返回 404，而 GET `/releases/410861902` 成功且 tag/draft/prerelease 精确匹配。新增明确产品草稿 ID 绑定与拒绝错误 ID 测试；4 文件 / 80 项测试通过。beta.2 未公开，保留 tag，改用 beta.3 发布。原生源码许可/运行库不变，复用已上传固定来源归档；最终准确应用源码将对应 beta.3 tag。

稳定 Windows、标准用户权限、4K/HDR、NSIS、SmartScreen 和签名升级尚未认证。社区数据目录独立于旧日常版。最终 GitHub 产品发行必须 prerelease=true、不标 latest，并附匹配源码与 SHA256SUMS；私有输入 draft 不得公开。

开发前快照：`2026-10-12_17-30-12-704_public-test-release`，checkpoint `checkpoint-20261013-013007-b810edc-public-test-release`；quick_check OK，维护脚本保留最近 3 份。
