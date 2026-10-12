# 公开测试版发行

## Context

2026-10-13（北京时间），维护者明确选择“先发布公开测试版，标注验证范围”。目标为 `0.1.15-beta.1` 绿色 ZIP 及对应源码，不提升为稳定版。

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

## Risks and follow-up

稳定 Windows、标准用户权限、4K/HDR、NSIS、SmartScreen 和签名升级尚未认证。社区数据目录独立于旧日常版。最终 GitHub 产品发行必须 prerelease=true、不标 latest，并附匹配源码与 SHA256SUMS；私有输入 draft 不得公开。

开发前快照：`2026-10-12_17-30-12-704_public-test-release`，checkpoint `checkpoint-20261013-013007-b810edc-public-test-release`；quick_check OK，维护脚本保留最近 3 份。
