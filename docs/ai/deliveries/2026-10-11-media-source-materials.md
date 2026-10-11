---
date: 2026-10-11
branch: ai/media-source-materials
type: docs
status: partial
---

# 播放器依赖源码材料恢复

## Context

用户同意先继续补齐第三方发布材料。基准为 `1cd91f69c67f0dd4de44507aaa4e21d6a22c12db`，工作区干净，与 origin/main 一致。已完成开发前快照 `2026-10-11_05-33-33-896_media-source-materials`、checkpoint `checkpoint-20261011-133330-1cd91f6-media-source-materials`，真实资料库 345892 条、quick_check 正常；授权维护脚本校验三份开发和三份迁移备份后清理一份旧开发快照，错误 0。未修改程序或真实资料库。

## Changes

- 新增 [libmpv 恢复证据](../../legal/MPV-DEPENDENCY-SOURCE-RECOVERY.json)：原构建日志 21 个更新目标的候选提交、固定配方/辅助函数、归档与通知哈希、实际容器摘要、公开附件/缓存查询结果。
- 私人保存 19 份源码归档，其中 18 份是新增依赖/头文件候选，另 1 份是已知内嵌 FFmpeg 重核；保存 35 份顶层原始通知。OpenSSL / ANGLE 使用固定配方 GIT_RESET，不使用远端最新 tip。
- 上游 mpv.pdb 与实际 libmpv DLL 的 GUID 不同，明确记录不能用于当前 DLL 的版本证明。fontconfig / SVT-AV1 已解析完整候选提交，但两种常规归档端点均返回 HTTP 406。
- 更新 89 目标机器清单和 [缺口说明](../../legal/MPV-SOURCE-GAPS.md)，新增候选没有覆盖实际 DLL 版本字段。
- 新增 [FFmpeg Lite 重核证据](../../legal/FFMPEG-LITE-SOURCE-REVERIFICATION.json)：固定私人 ZIP 外层 SHA 和内部 13 文件重新校验通过。

## Verification

- 原 DLL、原始日志、配方归档身份校验；PE Debug Directory / MSF7 PDB GUID+age 比对；19 TAR 的路径、大小和 SHA；35 通知原文 SHA：PASS。
- Lite 审核 ZIP 外层 SHA 固定为 `6ed202c4e30627624e2678a2a62e7c9c6e347be4a57d9b6af248fd45571b15d4`，14 条目、13/13 内部文件 SHA：PASS。
- 独立证据复核：89 目标的原始字段逐项与 HEAD 比对未变，只追加候选恢复字段；19 归档、35 原始通知、9 个文档链接再次核验；发行审批/运行库锁与 HEAD 内容及记录字节哈希一致：PASS。
- 初次默认 Node 24.14.0 / npm 11.9.0 被项目环境检查拒绝。随后仅为检查子进程 PATH 使用已有 `.tmp/runtime/node-v22.23.1-win-x64`，实际版本 Node 22.23.1 / npm 10.9.8；未改全局环境或项目锁定要求。
- 本轮锁定环境下 `npm run lint`、`npm run typecheck`、`npm run build`：PASS；`npm test`：134 个文件 / 1204 项全部 PASS；`npm run test:electron-smoke`：PASS，含原生 SQLite、三身份/DPAPI/换目录重开、preload 和主进程；`npm run test:media-candidate-contract`：60/60 PASS。
- `git diff --check` 和交付脚本 ValidateOnly：PASS。构建体积提示、PNG 色彩配置警告不导致失败；独立 E2E 脚本不存在，本轮没有再次操作沙盒或正式安装器。完整等价检查已实际执行并记录，自动交付可使用 `-SkipChecks`。

## Risks and follow-up

- 这是部分材料恢复，不能宣称取得完整对应源码或完成发行兼容性判断。除已知内嵌 FFmpeg 外，恢复候选尚未被 DLL 实际输入记录证明；未变缓存版本、子模块、生成配置、完整链接组件及通知覆盖仍缺。
- 两份 GitLab 下载失败；原 run 的 x64 完整日志附件与对应缓存 key 在查询结果中不存在。要确认历史输入仍需上游材料或其他可验证证据，不用新缓存/最新分支代替。
- 发行审批文件和运行库锁不变，`approved=false`、`manualQaApproved=false`、`distributable=false`，没有创建公开 Release。
- 本轮仅修改证据文档，不影响桌面行为，不重打包。已有私人绿色测试包继续对应 `19465ef7500fb53c325a5079126497e1fe34cd57`；正式桌面版本尚未交付。稳定 Windows 11 / 普通用户 / 真实高分辨率媒体验收仍待完成。
