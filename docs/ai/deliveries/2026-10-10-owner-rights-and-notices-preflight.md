---
date: 2026-10-10
branch: ai/final-owner-ffmpeg-review
type: docs
status: engineering-evidence-complete-owner-confirmation-pending
---

# 映匣免费开源版：所有权清点、FFmpeg 许可资料收口

## Context

用户先要求完成 FFmpeg 静态构建材料核对、项目权属清点、正式发行授权，再进行独立 Windows 11 验收；只允许在家用 B5 研发，办公 D200707 仅用于以后隔离 Win11 验收。本轮没有接触办公电脑。

变更前已执行备份 `checkpoint-20261010-121247-f4cc402-final-owner-and-ffmpeg-materials`，家用 SQLite 345892 视频、quick_check OK，工作区干净。以 PR #24 f4cc402 代码为基准独立分支开发。

## Changes

- 增加 `docs/legal/PERSONAL_RELEASE_FINAL_DECISIONS.md`：从实际二进制 `ffmpeg -L`、`-buildconf` 和已归档源码/锁文件核对 FFmpeg 8.1.2 的 LGPL 2.1+、SHA256、静态编译和外部调用关系。明确“完整源码归档”不能自动代表 LGPL §6 的重链接要求已实际通过；不自行出具法律意见。明确 OpenH264 为 MSYS2 编译产物，不能宣称拥有 Cisco 仅针对特定下载二进制的专利许可。
- 从 Git 仓库检查 MIT 许可证署名（huntian0727）、Git 历史作者（huntian0727、Codex），追踪文件格式清单并**逐张打开**三张 `docs/screenshots/*.jpg`：均为本项目应用界面及 `sample.mp4`、QA 生成目录等合成数据，无真人、第三方影视、办公资料或个人用户名可辨。仍不能代用户声称绝对权利归属。
- `scripts/prepare-community-release-attachments.mjs` 原先只有 LGPL 文本，补足编译输出对应的所有 **6 份原生组件原文与来源通知**：LGPL、FFmpeg SOURCE、oneVPL、OpenH264、winpthreads、GCC，每项要求与锁文件 SHA256 一致。对 MSYS2 OpenH264 非 Cisco 二进制的专利条款加入提醒。
- 新增 1 项针对 6 份通知名称的回归检查；更新 `docs/OPEN_SOURCE_RELEASE_SIMPLE.md` 和 `docs/RELEASE_CHECKLIST.md` 指向最新材料与决策记录。
- B5 生成**新的私有、待发布** `D:\CodexReleaseAudit\movie-community-support-20261010-owner-review`，15 项来源/许可证资料 + SHA256SUMS / STAGING-STATUS；实际 15/15 内容重新哈希核对通过。离线资料不能作为已公开发布或已履行全部 LGPL/专利义务的证明。

## Verification

- 当前 FFmpeg 实物校验：`ffmpeg.exe` dd2ae91c672ecc7d9233a7ed075dc9437aa817cfb68dce66b172bd61e25cbbe4；`ffprobe.exe` 57dec3db58729d5f00794bf65d76f15f9278c457989e4a649a02063abdd19bc8；`ffmpeg -L` 输出 LGPL v2.1+；`-buildconf` 已在上轮完整归档。
- 新私有材料确实 15 项 SHA 检查通过，状态 `approved=false` 且不包含 EXE。
- 项目保护文件 `build/release-approval.json.approved=false`、`scripts/native-media-lite.lock.json.distributable=false` 保持原样；没有发布 tag、GitHub Release、合并 main 或安装办公宿主。
- 最终测试数和工具输出在提交过程中核实；不将历史检查误写为本轮执行通过。

## Risks and follow-up

- 目前**尚无真实修改 FFmpeg 后重新构建/重新链接并完成受限技术审核的证据**；原生 OpenH264 专利问题与不同地区法规仍应当谨慎评估。自有版权仅能由有权者本人确认，不能按仓库名字或 AI 作者署名推定。
- 目前缺少维护者对源代码/截图确实拥有 MIT 授权范围的一句事实确认，也还没有“允许立即上架已经 QA 通过的特定制品”的最终动作授权。必须等独立稳定 Windows 11 QA 通过、安装器 SHA 与媒体源码对应、维护者明确放行后，才可更改 release-approval 或对外发行。
