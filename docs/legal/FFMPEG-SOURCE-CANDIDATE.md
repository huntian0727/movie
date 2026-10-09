# Windows 媒体工具替换与原生源码证据（2026-10-09）

> **CANDIDATE / NOT APPROVED FOR PUBLIC DISTRIBUTION**。这是源码溯源与测试记录，不是许可、漏洞修复或对外分发批准。测试安装包不得作为公共正式版上传。完整分发前仍须取得权利人授权、各启用库对应源码/补丁及许可证证据。

## 实际替换

- 运行代码不再加载 GPL-3.0-or-later 的 `ffmpeg-static` JavaScript 包装层，`ffprobe-static` 同时移除，生产 `package.json` 与 `package-lock.json` 均不再依赖这两个包。
- `src/main/media/mediaBinaries.ts` 严格使用物理 `resources/media-tools/{ffmpeg,ffprobe}.exe`，源码开发期使用忽略目录 `native-bin/media-tools`；已打包应用若工具缺失，拒绝退回 PATH 或不受信任的用户环境二进制。两条路径均由相同来源锁提供。
- `scripts/prepare-native-media.mjs` 下载精确 Release ZIP 或复用已存在的隔离输入，对 ZIP 和每个 EXE 逐字节 SHA-256、二进制架构、版本、构建配置、LGPL 声明及许可证内容复核后才将候选文件拷入忽略目录；未批准的状态不可修改。构建前 `scripts/run-electron-builder.mjs` 再核验二进制及许可证精确 SHA。
- installer 经 NSIS 专用测试身份运行。法律通知及来源状态文本随测试包附带，但这些文本没有取代缺失的全部第三方源码链。
- 对 `native-bin/media-tools` 仅写入特定忽略子目录，不会写用户真实视频/SQLite，也不会改变旧安装器。未发布正式安装包。

## 来源材料：已经实物归档

| 对象 | 精确版本 / 来源 | 实测 SHA-256 |
| --- | --- | --- |
| Windows x64 LGPL ZIP | [BtbN autobuild-2026-10-05-13-07](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-05-13-07) / `n9.0.2-22-g46d8f462ee-20261005` | `1c73d2256f0198805daf0f765feab8d3f21d3ab85e8dda0c2bb44ce1e3a126c7` |
| FFmpeg.exe | 同一 ZIP，独立提取 | `5054ceae23d3d3bb1938c337838333be0a444305a3d89d53e184a9366a49edc9` |
| FFprobe.exe | 同一 ZIP，独立提取 | `2e9e184daf8a35da5ef0d8508ae8d9a0ba482896b1a03f06e03f458dc2266be5` |
| BtbN 构建工程源码包 | `BtbN/FFmpeg-Builds` commit `9acad4a9ef1583096af7836cc1e9c8cbcb4d3950`（build scripts LICENSE 为 MIT） | `27dca8db7b2466b6f5145168721264de91dc9b56f50bebc441249f92e4acf548` |
| FFmpeg 主源码归档 | `FFmpeg/FFmpeg` commit `46d8f462eeb87ee1f704d8c44a0ee24fca471ad1` (2026-09-30) | `56999ad7cdcfbe520e989e38ac763341fab71b367ef8c20434117f8d1b7204a9` |

上述 ZIP 与来源归档在家用机 **D:/CodexReleaseAudit/media-candidate-20261008/** 下隔离保存；`scripts/native-media-candidate.lock.json` 固定 ZIP 与实际运行 EXE。归档未自动上传到公共 GitHub。

## 尚未闭环的源码/合规链

该 LGPL 构建启用了 **43** 个 `--enable-lib*` 外部库；在 BtbN 构建目录中已经为 **43** 个启用库全部定位到候选 recipe；其中 `liboapv`→`openapv`、`libopencore-amrnb`/`libopencore-amrwb`→`opencore-amr`、`libvpl`→`onevpl` 需要识别构建脚本和 FFmpeg 标志的命名差异。**找到 recipe 仍不等于已取得实际编译所用的完整版本源码、许可证、补丁或构建证明**。可机读候选匹配见 `docs/legal/ffmpeg-source-candidate-inventory.json`。

仍需按所选 `win64 lgpl` 和实际 CI run 提取每个外部库确切下载版本/签名/完整源码、编译参数、补丁、许可证、构建镜像及静态链接可能引入的 LGPLv3 重新链接义务。找到 FFmpeg 主源码与构建脚本，只解决其中两个环节，**不能**等同全部对应源码或证明任意 FFmpeg 安全 CVE 已修复或不适用。

## 运行/验收

开发期（Windows x64 / Node22.23.1 / npm10.9.8）可设置 `MOVIE_MEDIA_CANDIDATE_DIR` 为存有上述完整 ZIP、两个 EXE 与 LGPL 文本的隔离目录，然后执行 `npm run prepare:media-tools`，或由该脚本下载上面已锁定的 GitHub Release。重跑 `test:release-gate`、`dist:win`、`verify:artifact`、`release:metadata`、`test:packaged-smoke`、`test:installer-smoke` 才能核验打包产物；最新实际测试状态记录在 `docs/ai/deliveries/2026-10-09-media-binary-wrapper-removal.md`。遇到缺少来源/哈希错误必须失败关闭。

**正式发布状态：FAIL**。不得因为 JS 包装层已移除、两个 EXE 都报告 LGPLv3，或本地打包 smoke 通过，就把发行审批字段修改为通过。

## 上游每日构建保留期风险（新增发布阻断）

BtbN 构建仓库 README 明确说明仅保留最近 **14** 份每日构建，每个月最后一份构建可保留约两年。本轮选用的 `autobuild-2026-10-05-13-07` 是非月末每日构建，**未来 GitHub Release 资产可能删除**，不能承诺长期可重放下载。当前锁定哈希、隔离 D 盘归档和失败关闭逻辑可防止在来源失效时偷换 `latest`，但不等于已经解决稳定来源分发。正式发行前需要选择审核完整的长期保留构建（如月末）或落实许可允许、完整受审的自建复现/持久镜像方案；没有这些材料，持续 CI 的一次成功不等于可长期复现。

## 2026-10-09 来源引用与直接依赖初审（追加证据）

在家用机 B5 实际核对 BtbN 源码压缩包 SHA，解析 **43 项启用外部库的 44 份候选构建脚本**：43 个固定完整 Git Commit、一个 `libmp3lame` 固定 SVN r6835，合计 42 个不同来源仓库；初步提取 16 份 recipe 内的简单直接依赖声明（18 种名字）及 4 份补丁的 SHA。另以 GitHub API 取得 **opus 与 libass 在精确源码 commit 下的 COPYING 原文并哈希**，未获得整套第三方完整源码。全部字段标记为未批准，对应证据见 [构建来源初审](FFMPEG-RECIPE-SOURCE-AUDIT.md) 和 [逐库机器核验 JSON](native-media-recipe-evidence.json)。

这一步解决“哪些源码应被收集”的追踪问题，而**没有完成对应源码、补丁应用与许可证授权链**，不触发分发批准。当前唯一允许的仍是隔离未签名测试包。

### 2026-10-09 两份完整上游源码已存档（独立补充）

B5 家用机在网络重试成功后取得精确 Git SHA 的 **Opus 和 libass 完整 GitHub 源码 TAR**，完整列出 TAR 条目且退出码为 0（Opus 840 条目，SHA-256 `e34101b726c033be40e3f5a2695d086362d59069554ffd46800c38a13eade1f7`；libass 155 条目，SHA-256 `edb3e866ca9394152484bc9a83b68a395f5c9052ae0dc502e4100035c250330b`）。原始 COPYING 同样逐字节获取和哈希，详见 [来源初审](FFMPEG-RECIPE-SOURCE-AUDIT.md)。**只完成 43 个外部库中的 2 个完整源码归档**，尚未证明二进制对应关系、静态许可证完整合规或所有传递源码，不改变正式发行 FAIL。

## 2026-10-09 固定 GitHub 源码原始许可证根文件核验

已基于 43 启用库对应的 42 不同上游源码位置，对全部 **29 个 GitHub 托管、精确提交的源码仓库**逐个校验了根目录文件，在 B5 的隔离审计文件夹保存了 **49 份**候选许可证、版权或作者文件及其 Git blob 和 SHA-256。**13 个非 GitHub 仓库尚未核验**；未执行完整源码与实际二进制对应审查。真实文本细节、人工风险和局限见 `NATIVE-MEDIA-LICENSE-EVIDENCE.md`，结构化记录见 `native-media-license-availability.json`。不能据此改变当前正式发行 FAIL。

## 2026-10-09 Lite 替代构建隔离 QA

新 [FFmpeg Lite 8.1.2 测试记录](FFMPEG-LITE-QA.md) 已证明 MP4/MKV、缩略图、完整 Electron 打包与内部 NSIS 安装/修复/卸载可用；启用的外部构建库明显更少。此分支只是通过显式 `MOVIE_MEDIA_VARIANT=lite-candidate` 提供内部 QA 候选，当前默认为原 BtbN 工具，旧版已验收测试包备份保存。源码/附属 DLL 合规和 GCC Runtime Library Exception 通知未闭环，**不将此记录作为任何可公开分发的批准**。
