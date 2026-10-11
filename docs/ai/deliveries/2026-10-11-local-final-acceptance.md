---
date: 2026-10-11
branch: ai/public-release-audit
type: docs
status: blocked
---

# 本机最终验收：管理功能通过，H.265 / MKV 播放阻塞

## Context

用户要求进入最终安装、启动、播放、卸载验收，随后明确改为在本地电脑测试，停止操作远程测试机。查询与实测日期采用北京时间 2026-10-11。

已从干净本地工作区切换到 `ai/public-release-audit`，执行 `git fetch origin` 与 `git pull --ff-only origin ai/public-release-audit`。验收基准为 `40a6925cf16af6bf4a94991f1080712869259690`。之前的安装器元数据指向 `f4cc402`，本轮重新构建，未沿用旧安装器。

开发前快照：`2026-10-11_03-16-39-216_clean-win11-final-qa`；已推送 checkpoint 标签 `checkpoint-20261011-111634-40a6925-clean-win11-final-qa`。SQLite 345892 条视频、quick_check=ok。成功创建后运行工作区维护脚本，保留最新 3 份开发快照；校验通过，删除 27 份旧快照、回收 23.657 GiB，错误 0。

## Changes

- 没有修改应用代码、播放器架构、发布门槛或批准字段。本文件记录真实失败结果，作为后续黑屏修复前的验收基准保存；修复与正式发行尚未完成。
- 使用仓库既有的 `.tmp/runtime/node-v22.23.1-win-x64`，仅为构建子进程设置 PATH；没有更改全局 Node 安装。默认 Node 24.14.0 / npm 11.9.0 被项目环境检查拒绝；正确的 Node 22.23.1 / npm 10.9.8 构建通过。
- 使用固定 SHA 的离线 Electron 44.7.0 ZIP 和显式 `MOVIE_MEDIA_VARIANT=lite-candidate`，重新生成隔离的 `unsigned-test-build` NSIS 安装器及目录包。
- 合成 3 份 35 秒、320×180、yuv420p、AAC 音轨的视频：H.264 MP4、HEVC MP4、H.264 MKV。编码器只用于产生测试媒体，没有加入新安装包。
- 使用默认隔离安装位置 `C:/Users/test/AppData/Local/Programs/拉面影视-unsigned-test-build`，以新建验收快捷方式启动实际安装的 EXE。测试结束已卸载，并核对目标和本轮描述后移除该验收快捷方式。原正式版快捷方式未改动。
- 本地诊断、合成视频和逐文件哈希保留在 `.tmp/local-final-qa/`。独立测试数据库保留在 `%APPDATA%/local-video-manager-unsigned-test/`，不含用户正式资料库。

## Verification

| 验收项 | 真实结果 |
| --- | --- |
| 本轮 Windows NSIS 构建 | PASS：`npm run dist:win`，Node 22.23.1 / npm 10.9.8，Electron 原生 SQLite smoke 通过 |
| 发布合同测试 | PASS：`npm run test:media-candidate-contract`，59/59 |
| 打包内容 / 许可证 | PASS：`MOVIE_MEDIA_VARIANT=lite-candidate npm run verify:artifact`，3461 个 asar 条目、7 份精确许可证说明，无禁止的开发产物 |
| 当前安装器元数据 | PASS：`npm run release:metadata`，commit 与本轮基准一致，签名状态 NotSigned，测试身份独立 |
| 自动安装 / 修复 / 卸载 | PASS：`npm run test:installer-smoke`，拒绝无关非空安装目录、修复保留文件、拒绝删除用户数据的参数、安装器内外 SQLite / 视频哈希保留；原正式版注册和快捷方式状态一致 |
| 安装后 packaged smoke | PASS：实际已安装 EXE 的 create / verify 两阶段；数据库、扫描、预览缓存/重新生成、Renderer/IPC 安全负向检查及查询 worker 通过 |
| 默认图形安装入口 | PASS：普通默认入口显示“已安装”，安装器退出 0；过程中未观察到管理员提权提示。自定义 `/currentuser /D=...` 图形启动尝试退出 1，尚未定位，不能把该路径写成通过 |
| 首次启动 | PASS：从本轮验收快捷方式启动；空资料库、设置及 SQLite 正常创建 |
| 目录添加 / 扫描 | PASS：通过真实目录选择框添加 `.tmp/local-final-qa/synthetic-media`；新增 3、失败 0、缺失 0 |
| 元数据 / 缩略图 | PASS：3/3 metadata_status=ready、thumbnail_status=ready；三个视频都有真实预览 |
| H.264 MP4 播放 | PASS：可见动态测试画面，进度约 4.5 秒；暂停稳定在 10.600 秒；快进后稳定在 20.600 秒且画面时间同步 |
| H.265 MP4 播放 | FAIL：黑屏，提示“内嵌 MPV 启动失败：请确认本机运行库已配置，或退回原播放器”，进度为 0；暂停 / 快进不能算通过 |
| H.264 MKV 播放 | FAIL：同样内嵌 MPV 启动失败、黑屏、进度为 0；暂停 / 快进不能算通过 |
| 真实程序重启 | PASS：正常退出并从同一验收快捷方式重启，3 条视频、1 个收藏、3 条最近播放仍存在 |
| 图形卸载 | PASS：向导显示“已从你的计算机解除安装”；安装 EXE、app.asar、测试注册移除，本轮验收快捷方式随后按归属检查清理 |
| 用户资料保留 | PASS：卸载前后 library.sqlite SHA256 一致 `eb3558ecf4c61dfa2525cdaa1dbb39fa2e647fbbf1b61e78897fb6960f114641`；schema=15、quick_check=ok；源视频 3/3 哈希一致。安装目录中额外放置的模拟用户视频和 SQLite 也逐字节保留 |
| 独立无开发环境 Win11 | NOT RUN：按用户指示本轮只在本机验收。本机是 Windows 11 Enterprise Insider Preview 10.0.26220 x64，装有开发与播放器工具，不能当作干净稳定 Windows 11 证据 |
| 无全局 Node / FFmpeg 依赖 | 未独立证明：本机存在这些工具；包内实际 FFmpeg / FFprobe 已经 packaged smoke 定位并执行，不等价于无开发环境验收 |
| 音频听感、长视频及复杂媒体 | NOT RUN：本轮工具检查画面/进度，未进行主观音频听感和大型真实媒体矩阵 |

本轮安装器：`release/unsigned-test-build/拉面影视-0.1.15-x64-unsigned-test-build-Setup.exe`。

安装器 SHA-256：`245676259129093d643258beff0a043d138ccc07d716ed7937db2857e6451ec4`。元数据：`release/unsigned-test-build/build-metadata.json`；校验和：`release/unsigned-test-build/SHA256SUMS.txt`。均为内部 QA 产物，未公开发布或改名为社区版。

## Risks and follow-up

1. **P1：首次安装不能独立播放 H.265 / MKV。** 当前 `src/main/index.ts` 把内嵌运行库目录固定到 `userData/native-player`；`src/main/embeddedPlayer/embeddedPlayer.ts` 启动时要求该目录具有 `libmpv-2.dll`。实物安装的 `resources/native-player` 只有 `NativeHost.exe`，新数据目录没有 libmpv。FFmpeg 有解码能力并能生成封面，不代表内嵌播放器的运行库已经具备。须在保持既有架构和许可证门槛的前提下解决运行库随安装交付 / 安全定位，再重测，而不是让普通用户手动配置或借用本机外部播放器来勾选通过。
2. 原生播放器依赖的准确版本、完整依赖、来源与许可必须核实；本轮没有擅自加入旧的或未审核的 libmpv DLL，没有因本机装有其他播放器而把失败判定为通过。
3. 自定义图形 `/D` 安装参数退出 1 的原因仍待检查；默认入口和现有 `/S` 自动路径通过。
4. `ownersConfirmed=true`、`approved=false`、`manualQaApproved=false`、`legacyUpgradeApproved=false`、原生源码合规批准及 Lite `distributable=false` 保持不变。实际 `build/release-approval.json` 还含其他证据 / 哈希门槛，不能只把两个布尔值改为 true 来发布。
5. 未生成公开社区安装器、正式 Release tag 或 GitHub Release；没有更新 main。本机测试安装已卸载，**正式桌面版本尚未交付**。当前资料库、源视频、原使用中的程序与正式桌面快捷方式未清理。
