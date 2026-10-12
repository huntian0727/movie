# 公开测试版发行

## Context

2026-10-13（北京时间），维护者明确选择“先发布公开测试版，标注验证范围”。首个可用版本目标为 `0.1.15-beta.2` 绿色 ZIP 及对应源码，不提升为稳定版。

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

稳定 Windows、标准用户权限、4K/HDR、NSIS、SmartScreen 和签名升级尚未认证。社区数据目录独立于旧日常版。最终 GitHub 产品发行必须 prerelease=true、不标 latest，并附匹配源码与 SHA256SUMS；私有输入 draft 不得公开。

开发前快照：`2026-10-12_17-30-12-704_public-test-release`，checkpoint `checkpoint-20261013-013007-b810edc-public-test-release`；quick_check OK，维护脚本保留最近 3 份。
