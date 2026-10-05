---
date: 2026-10-05
branch: ai/subtitle-free-sources-v1
type: feat
status: user-test-pending
---

# 迅雷与 Subtitle Cat 无密钥字幕来源

## Context

用户授权按照 115Master 1.13.0 的字幕来源思路开发，并明确由用户进行真实影片测试。Workflow FULL；开发者完成契约与发布技术检查，不派独立 QA/UI Agent，不自称体验验收通过。用户验收为 PENDING。

- 基线 `259049a0845ff34a83396333b9e631508f2367fc`，工作区干净。
- 完整备份 `2026-10-05_14-07-55-576_subtitle-free-sources-v1`；标签 `checkpoint-20261005-220751-259049a-subtitle-free-sources-v1`。备份 Verify 成功，SQLite quick_check ok、schema 14、345479 条记录。标识中的时间为原始快照 ID，本文时间说明采用北京时间。

## Changes

- 迅雷无账号来源默认可选，使用固定 `/oracle/subtitle?name=` 获取候选，保留完整文件名发行版本线索；用户编辑查询后优先使用编辑后的值。仅选择候选后下载，原账号配置不参与。
- 迅雷语言未标注时显示“语言未确认”；中文/英文/双语筛选只使用明确标出的文件名线索，不当作实际语言确认。
- Subtitle Cat 作为单独可选来源，不加入默认聚合。固定网站、parse5 7.3.0 有界 HTML 解析、按名称词项匹配，下载时才解析所选语言链接；支持中文/英语，拒绝未经核实的双语筛选。
- 所有文件沿用主进程来源 UUID、HTTPS 下载/重定向主机白名单、大小/超时限制、文件版本关联、内容验证及原子发布；源视频不变，字幕保存、MPV/Chromium 加载、偏移与导出沿用既有实现。原凭据损坏不阻止无账号来源。
- 更新 shared 来源/语言枚举、固定网站映射、服务、设置与弹窗；增加必要契约回归，模块 README 与用户测试说明。parse5 原为 dev 间接依赖，此次加入运行依赖和 lock，不引入浏览器或脚本执行。
- 不复制原脚本的毫秒解析错误，不加入 AI、115 登录、CloudDrive、批量任务或播放时自动联网。

## Verification

- 定向技术检查 PASS：5 个文件 / 47 项，包括旧来源、无密钥/未知语言、非可信 URL 与每次重定向、HTML 实体/后排结果、错误与大小限制、无急切下载、凭据损坏隔离、持久化及新来源选择。
- 完整发布门禁 PASS：固定 Node 22.23.1，lint/typecheck/build、Windows 文件 37 项、迁移 32 项、性能 31 项、112 个文件 / 972 项；日志 `.tmp/free-subtitle-release-gate.log`。首轮发现新增测试 Mock 类型错误，修正后完整重跑，没有跳过失败。
- 实现提交 `fc9ad08ec925f8755b142a00161ad4faf4582259`。隔离 checkout 的 build 和 Electron 33.4.11 ABI 130 main/native smoke PASS；后续交付提交只含文档和 handoff。最终 Commit 后重建包、执行 artifact/packaged smoke、部署并核对原快捷方式/Commit/app.asar；实际结果在 `.tmp/free-subtitle-desktop-proof.json` 与最终回复报告。该步骤只确认可启动及入口存在，不代表真实影片验收。
- 没有运行用户影片的真实网站下载或匹配/语言/同步/译文验收；由用户负责，**NOT RUN / USER_TEST_PENDING**。此前分析阶段的公开样本接口探测不作为新版本体验验收。
- Git diff/check、正常推送分支与 main、main 更新前备份标签以最终脚本结果为准；使用 SkipChecks 仅基于本轮实际完成的等价技术检查。发布为原快捷方式指向的 unpacked 程序，不声称生成 NSIS 安装器。

## Risks and follow-up

- 迅雷不是已确认长期开放的稳定开发者 API；Subtitle Cat 页面/语言下载链接可能变化。服务错误单独可见，保留其他来源供切换。
- 迅雷文件名语言线索可能错误，Subtitle Cat 译文可能为机器翻译，匹配分不能保证同步。Cat 搜索候选并不承诺所选语言一定有文件，下载时核实。
- 外部播放器仍需手动加载导出文件，Chromium ASS 只显示基本文本，压缩包/图像字幕/字体不支持。
- 用户测试指南：`docs/ai/subtitle-free-sources-user-test.md`。按来源/搜索词/候选名称/实际语言/偏移/错误步骤反馈；不要求提供密钥。
- 回滚用本轮检查点或正常 revert 分支；不强制推送或覆盖正在运行的资料库。
