---
date: 2026-10-15
branch: ai/readme-screenshots
type: docs
status: completed
---

# GitHub 首页补充实际界面截图

## Context

用户希望 GitHub 项目首页用更多截图清楚展示软件。原 README 仅引用一张历史合成资料库截图，本次仅维护公开文档与图片。

开发前基准为 `1381b5e`，工作区干净。已生成一致性备份 `2026-10-15_15-48-41-711_readme-screenshots`，checkpoint 为 `checkpoint-20261015-234834-1381b5e-readme-screenshots`（已推送）。随后按工作区约定运行备份维护脚本，保留最近三份快照，校验通过后清理一份历史存档，无错误。

## Changes

- README 新增“界面预览”，六张截图逐一配合场景说明：网格、时间轴、独立播放、目录和图片、资产中心、视频数据表。
- 图片使用 0.1.15 正式绿色程序（`build-flavor.json` 标记 `unsigned-public-release`，源码 `092cb79f018693ffa3b69e39408ccc44b66d7688`）实际运行捕获；未使用开发中的配置 API 快捷入口。
- 全新隔离资料库中实际扫描六段 FFmpeg 自制样片，等待封面和时间轴生成，通过界面收藏及播放，并查看三个样片提取图。发布截图不含维护者真实资料库、网盘 Token 或私人文件名。
- 新增截图来源、版本及后续维护说明，保留旧图用于历史引用；在 Changelog Unreleased 中记录本次文档改动。

## Verification

- 人工逐张检查六个实际窗口捕获：PASS。预览全部加载，播放器有视频画面，资产中心与数据表均为六条示例记录，目录显示两个子目录和三张示例图片。截图只呈现所述界面，不作为新的兼容性或音频验收结论。
- `npm run lint`、`npm run typecheck`：PASS（Node 22.23.1 / npm 10.9.8）。
- `npm run test`：PASS，140 个测试文件、1293 项测试。
- `npm run build`：PASS，存在原有非阻断分包大小提示。
- `npm run test:electron-smoke`：PASS。
- E2E：不适用，`package.json` 未定义独立 E2E 脚本。
- `.tmp/readme-screenshots-check.mjs`：PASS，35 个本地文件链接、六张图片唯一引用、JPEG 格式/尺寸与 SHA-256、截图程序发行身份核对均通过。六张图合计 625,198 字节；结果保存于忽略的 `.tmp/readme-screenshots-proof.json`。
- `git diff --check`：PASS。

## Risks and follow-up

- 自制示例媒体不随程序提供，截图中的规模和状态仅反映演示资料库；不据此宣称所有设备、格式或网盘都已测试。
- 图片原样保留采集工具 JPEG 输出；部分页面以应用内 90% 比例展示完整面板。以后功能变动按版本重新采集，避免公开包和截图不一致。
- 自动交付脚本同步功能分支及 `main`，同时为旧 `main` 创建备份标签；不修改现有 Release、tag 或下载附件。

## Documentation and release impact

- 首页展示变化已记录到 `CHANGELOG.md` 的 Unreleased 文档条目。
- `docs/USER_GUIDE.md` 和 `docs/user-guide/0.1.15.md` 无需修改：没有增加功能或变更操作步骤，已有教程与新增截图描述一致。
- 桌面交付：不适用，仅文档和图片修改，无应用行为/界面代码变化，无需构建替换维护者日常程序或修改快捷方式；截图使用已发布程序的独立资料库。
- 发版任务：不适用，公开下载继续为既有 0.1.15。
