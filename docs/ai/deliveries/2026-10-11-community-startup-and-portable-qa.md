---
date: 2026-10-11
branch: ai/community-startup
type: fix
status: partial
---

# 社区版启动身份与绿色包收尾验收

## Context

用户要求在本机继续修复播放黑屏后的发行收尾，并以解压即用的 Windows x64 ZIP 为目标。此次范围是已有实现的修复和验证，没有重新设计项目。上轮播放器运行库修复基准为 `7e3d28f`。

开发前完整快照：`2026-10-11_04-06-28-914_community-startup`；远程 checkpoint：`checkpoint-20261011-120624-7e3d28f-community-startup`。源库 345892 条视频、SQLite quick_check 正常。备份维护已按授权执行，三份开发快照及三份数据库升级备份核验通过后清除旧快照。

## Changes

- 修复运行时拒绝 `unsigned-public-release` 的问题，校验三种发行身份、应用 ID 和固定资料库目录的完整对应关系。错误/缺失标识在数据库访问前失败关闭。
- 社区、测试、历史签名版分别使用独立 AppData 目录；历史签名版与开发环境的位置不变。同身份程序换目录后重开原资料库，不自动跨身份迁移凭据。
- 新增真实 Electron 的三身份 SQLite/DPAPI 设置 smoke：使用合成构建元数据和临时目录，不改发行审批、不生成公众版产物。
- 手动社区候选工作流改为 ZIP，保留原审批、标签、权限和签名校验。`verify:zip` 增加审批哈希及实际 EXE/NativeHost Authenticode 检查；工作流只上传校验元数据。
- 私人附件整理器加入锁定 MPV 原始通知、绿色版说明和实际构建证据。取得准确 mpv、内嵌 FFmpeg 主源码及构建配方归档，完整列举和 SHA 校验通过；配方/运行库含 GPL 构建路径证据，全部静态依赖版本及源码仍缺失，不作发行批准。
- 补齐绿色版数据保留说明及 Release 草稿的实际状态。自有代码权属已确认，不等于第三方二进制放行。

## Verification

均在本机 Windows 11 Enterprise Insider x64 运行，构建使用固定 Node 22.23.1/npm 10.9.8 和已验证离线 Electron ZIP。

- `npm run lint` / typecheck、`npm run build`：PASS。
- `npm test`：PASS，134 个文件、1204 项 Vitest。
- Windows 文件操作 37 项、数据库迁移 40 项、发行性能 31 项：PASS。
- `npm run test:media-candidate-contract`：PASS，60/60。
- `npm run test:electron-smoke`：PASS，包括原生 SQLite、主进程、DPAPI、preload 和新增三身份实际数据重开。
- `npm run test:renderer-security-smoke`：PASS。
- `npm run package:dir`、`npm run test:packaged-smoke`：PASS，包括创建/重开数据库、扫描、缩略图、预览及拒绝不可信 IPC。
- `npm run dist:zip` / `npm run verify:zip`：提交前候选 PASS，3462 项 ASAR、8 份主要通知、解压后 189 个文件逐一 SHA 相同；EXE 和 NativeHost 为 NotSigned。该候选不冒充提交后最终包；提交后再次生成并校验的真实 commit、路径和 SHA 以 `release/unsigned-test-build/portable-qa.json` 为准。
- `audit:msys2-provenance` / `audit:msys2-sources`：PASS，五个 DLL 字节对应、四套包配方和完整源码包对应。
- 社区工作流 YAML 和 PowerShell 两段语法检查：PASS；只上传元数据的路径检查 PASS。GitHub Actions 实际派发：NOT RUN（门禁关闭）。
- 正式审批拒绝负测试：PASS，真实审批仍为 false 时正式检查阻止构建，审批文件 SHA 未改变。
- 从本人创建的桌面绿色测试快捷方式实际启动解压包：视频库三条合成视频/收藏/最近记录可见；H.265 和 MKV 实际彩色活动画面正常，播放器音量为 20%。本轮连续播放及声音确认结果另见下文最终验收记录。
- 独立 E2E npm 脚本：不适用；已运行真实 Electron 和打包产物 smoke、实际桌面 GUI 操作。

连续播放最终结果：PASS，合成 HEVC 实际运行 600.193 秒，无错误；期间暂停/恢复、回退 5 秒、全屏切换、改变窗口大小均保持播放，结束时视频时间 594.425 秒。只使用本候选固定 NativeHost/DLL 的隔离拷贝；静音，音轨选择不等于人工听到声音。先前两次测试脚本尝试分别因提前设置音量、暂停回复的时钟快照断言不准确失败，已修正测试等待方式；不隐瞒失败尝试、不据此宣称产品缺陷已修复。失败和最终报告保留在忽略的 `.tmp/community-startup/`。

人工试听：未确认；助手不能从截图或已选音轨证明扬声器有声音。

## Risks and follow-up

- 正式发布仍阻塞：libmpv 全部静态依赖版本/源码/通知及宿主组合发行条件、FFmpeg Lite 最终源码公开与适用的重链接材料、干净稳定 Windows 11 无 Node/FFmpeg 的交互验收、真实用户媒体试听。
- 本机无 Windows Sandbox；Hyper-V 查询权限被系统拒绝，尚无可用干净虚拟机证据。本机 Insider/开发环境回归不代替该验收。
- 已整理 `D:/CodexReleaseAudit/movie-community-review-20261011` 的 21 份私人审核附件并逐一校验。随后主源码证据继续补齐，最终文档以仓库当前文件为准，该历史目录不声称同步之后的文档改动。三份主源码归档在 `D:/CodexReleaseAudit/movie-mpv-partial-sources-20261011`；仍标记 PARTIAL / NOT APPROVED。
- `ownersConfirmed:true`，`approved:false`，`manualQaApproved:false` 及各二进制源码审批保持不变；未发布 GitHub Release、未上传候选二进制、未推版本发布标签。
- 正式桌面版本尚未交付：原日常桌面快捷方式及 `release/win-unpacked` 不以未获准测试身份替换。绿色测试入口为 `C:/Users/test/Desktop/拉面影视-绿色测试版.lnk`；提交后将它更新到最终 `portable-qa.json` 指定解压目录并再次从该快捷方式启动验证，记录在忽略的本机 QA 文件中。它使用隔离测试资料库，不读取真实视频库。
- 同机解压即用已验证；AppData 数据及 DPAPI 凭据并非随程序文件夹跨电脑携带。高分辨率/HDR、更多真实编码、DPI、超过本次时长的长播放仍需继续验收。
- 本轮完整质量检查已实际执行并记录，自动交付脚本可用 `-SkipChecks` 避免重复等价检查；正常推送功能分支和 main，先保留远程 main 备份标签，禁止强推。
