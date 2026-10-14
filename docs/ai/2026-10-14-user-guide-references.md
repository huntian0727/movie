# 使用教程结构参考

查询时间：**2026-10-14 11:33:06，北京时间（Asia/Shanghai）**。数据实时取自 GitHub REST API，Star 为精确数；最近代码日期使用默认分支 HEAD 的 **committer.date**，没有使用 `updated_at`。首次 Release 指 API 返回的现存公开 Release 中最早 `published_at`，不代表历史上未曾删除的发行。

本次仅研究教程组织方式，不安装、运行或引入这些项目及其依赖；不是替用户推荐替代软件。

| 项目与仓库 | 用途 | Star | 仓库创建日期（北京） | 首次 GitHub Release（北京） | 默认分支最近代码提交（北京） | 适用性与维护状态 |
| --- | --- | ---: | --- | --- | --- | --- |
| [LocalSend](https://github.com/localsend/localsend) | 局域网文件分享工具 | 94,306 | 2022-12-16 08:46:07 | [v1.3.1，2023-01-05 06:47:28](https://github.com/localsend/localsend/releases/tag/v1.3.1) | [main，2026-10-10 09:13:49](https://github.com/localsend/localsend/commit/14f3a87426eedffaa9d87d011132eca5501abeb8) | 未归档、未禁用，近期有提交；适合借鉴下载入口、兼容性、用户排错与开发构建分层 |
| [ShareX](https://github.com/ShareX/ShareX) | 截图、录屏与桌面工具 | 40,056 | 2013-10-09 07:32:10 | [v8.3.0，2013-11-14 18:23:08](https://github.com/ShareX/ShareX/releases/tag/v8.3.0) | [develop，2026-10-14 10:34:47](https://github.com/ShareX/ShareX/commit/cb360c1bab5cca1775dc4225dcd14829a0642b8b) | 未归档、未禁用，近期有提交；适合借鉴每项功能的入口、基本步骤、说明与快捷键表 |

元数据来源：[LocalSend 仓库 API](https://api.github.com/repos/localsend/localsend)、[ShareX 仓库 API](https://api.github.com/repos/ShareX/ShareX)；各行链接包含精确提交和首次 Release。查询遍历现存公开 Release（LocalSend 27 条，ShareX 90 条），没有把仓库创建日当作发版日。Star 和默认分支会随时间变化，上表仅表示查询时状态。

## 文档阅读与采用方式

- [LocalSend README](https://github.com/localsend/localsend/blob/14f3a87426eedffaa9d87d011132eca5501abeb8/README.md)：先让用户知道下载什么、系统要求与使用条件，排错表按现象组织；开发构建另列。本项目采用“README 下载入口 → 快速开始 → 完整教程 → 按现象 FAQ”。LocalSend 的便携数据模式属于它自身功能，本项目没有照搬其设置文件行为。
- [ShareX Region Capture](https://getsharex.com/docs/region-capture)：按功能解释入口、操作流程和适用场景；[Keybinds](https://getsharex.com/docs/keybinds)按使用位置列快捷键。本项目采用相同的信息层级，所有按钮名称、快捷键与文件操作行为重新按 Movie 代码核对，没有复制第三方教程正文。
- 关键依赖背景：LocalSend 官方 README 介绍 Flutter / Dart 与 Rust 的构建要求；ShareX 当前默认分支的 [项目文件](https://github.com/ShareX/ShareX/blob/cb360c1bab5cca1775dc4225dcd14829a0642b8b/ShareX/ShareX.csproj) 指定 .NET 10 Windows 目标并引用 Avalonia、SkiaSharp 等。默认分支依赖不等于其已发布版本要求；这些也不是 Movie 的运行要求，未测试这两个工具的本机兼容性。
- 两项目均未被归档，不能据近期提交推断全部功能稳定；本次仅借鉴文档写法，不作性能、隐私或兼容性比较结论。

## 本项目的版本边界

本次比对 `v0.1.15` 与 `c51a9c3`：公开包的主要用户界面、字幕与目录功能一致；“API 添加窗口 → 配置 API”是开发新增入口，不写进 0.1.15 教程。最新教程独立注明该未发布差异。

文档分为 `docs/USER_GUIDE.md` 最新状态、`docs/user-guide/0.1.15.md` 公开版本快照和 `CHANGELOG.md` 未发布/已发布记录；发版按 `docs/DEVELOPMENT_AND_RELEASE.md` 同步更新。发布说明只补教程链接，不替换既有程序、源码、验证或校验附件。
