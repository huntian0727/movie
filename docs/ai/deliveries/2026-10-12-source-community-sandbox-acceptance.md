---
date: 2026-10-12
branch: ai/source-community-sandbox-acceptance
type: docs
status: partial
---

# 云端社区绿色包：本机沙盒验收记录

## Context

用户指定在本机 Windows 沙盒验收。开始时已无运行中的旧沙盒会话，未关闭或重启用户的旧会话；旧桌面真实视频目录无法直接访问。本次使用保留的中性命名真实 H.265/PCM 样本与合成视频，单独核验新云端包，未套用旧播放器的验收结论。

开发前快照：`2026-10-12_15-32-33-717_source-community-sandbox-acceptance`；checkpoint：`checkpoint-20261012-233224-a415bc0-source-community-sandbox-acceptance`。快照成功后执行工作区维护，全部保留快照哈希/数据库与三个升级备份校验通过，保留最新三份开发快照，删除一份旧快照，回收 0.876 GiB，无错误。

## Changes

- 新增 `docs/QA/2026-10-12-source-community-sandbox-evidence.json`，记录这次实际运行的 ZIP、环境、逐格式画面/声音、播放控制和三个数据保留节点。
- 将用户本轮三条回答绑定到五类视频：真实 2560×1440 H.265/PCM A-law、H.264/AAC、H.265/AAC、H.265/DTS MKV、VP9/Opus MKV。前两条回答为“声音正常”，后三类共同回答为“三类声音都正常”。
- 补充发行指南与最终决策记录中的最新 QA 状态；没有修改应用代码、审批文件、原生运行库或已验证的 ZIP。
- 仓库只保存中性测试名称、技术结论与收据哈希。机器标识、真实私有路径、截图、数据库、日志、视频和密钥不提交。

## Verification

- 被测包：云端工作流 `38237353737`，代码 Commit `41b44c7d4fea4c04b162ea6c8124ee1e3db684e1`；ZIP 212842097 字节，SHA-256 `3a6e456e54aa332387cc228ad9041e7ce6066f45941b9437e4ffa961696e7b07`。本次文档提交不改变被测包。
- 沙盒：Windows 11 企业版 Insider Preview，26100.9606，AMD64，默认 WDAGUtilityAccount；不是稳定系统或标准用户权限证明。启动前 Node/npm/FFmpeg/FFprobe/Git/Python 命令均不存在，社区资料库尚不存在。
- ZIP 哈希、解压后 231 个文件与固定清单逐文件匹配：PASS。程序直接启动、数据库初始化、两阶段 packaged create/verify smoke：PASS；包括实际扫描、缩略图/缓存、重开数据库及 Renderer/桥接安全检查。
- 10 个视频、2 个目录扫描：PASS；新增 10、失败 0，所有元数据与缩略图 ready。四份两分钟合成片由保留的十二秒视频流复制循环生成，使用本次云端包内 FFmpeg，不改动原样本。
- 五类画面持续变化：PASS；五类声音：PASS_USER_CONFIRMED。本次真实视频及 H.264、Opus 的暂停/跳转/恢复与进度预览可见：PASS。真实视频暂停 00:25 后保持不动，跳转约 03:04 后恢复；本次观察总时长 07:48，未作全时长播放结论。
- 正常退出后的 SQLite quick_check：ok。10 个视频、2 个目录、1 个收藏、7 条播放记录保留，六个原样本哈希不变：PASS。
- 在沙盒内移动程序目录后启动：PASS；收藏、全部记录仍在，真实视频从保存的 298904 ms 恢复到约 05:00 并推进至 05:30。再次退出 quick_check：ok；只有该续播视频的保存进度增加，其余记录与前一节点一致。
- 删除明确核对过的沙盒程序目录后：程序不存在，资料库 quick_check 仍为 ok，10/2/1/7 的数据与前一节点一致，原视频哈希不变：PASS。随后从同哈希的只读恢复副本启动，GUI 再次显示原资料库；这发生在删除收据之后，不把最后状态描述成仍未安装程序。
- 文档证据 JSON、三份收据/包哈希、五类音频确认、审批保持 false 与隐私字段验证：PASS；实际重新核对本次 ZIP 哈希与 231 文件的解压收据。`git diff --check`：PASS。
- 本轮锁定 Node 22.23.1/npm 10.9.8，实际重新执行 lint、typecheck、test、build、Electron smoke：PASS。Vitest 138 文件 / 1246 测试通过；Electron 验证四个发行身份、三个 SQLite/DPAPI 资料库、社区 QA 到社区正式身份的数据保留、移动目录重新打开与资料库隔离。没有套用上一轮测试结果。
- 自动交付使用 `finish-and-push.ps1`；只有在上述五项完整实际检查全部通过并记录后，才传入 `-SkipChecks` 避免在同一轮重复运行。
- 本项目未声明 E2E 脚本：不适用。本次没有重新打包日常桌面程序。

## Risks and follow-up

本轮指定沙盒范围内的功能与声音验收完成。预览系统与默认沙盒账号不能冒充稳定 Windows 11 标准用户验证。三例进度预览图可见，但十条数据库的 `timeline_preview_status` 仍为 pending，故不认证全部持久化时间轴任务完成；全部封面就绪与此区分。没有增加 4K/HDR、全时长压力、安装器、SmartScreen 或历史签名升级结论，双音轨/字幕测试片本轮仅扫描。

正式发布仍待第三方适用条件与对应源码材料收口、既有稳定普通用户环境覆盖、最终公开授权；不重复旧 Lite 静态路线的工作。两份真实审批文件仍保持关闭，未创建版本 tag 或公开产品 Release。日常桌面快捷方式未替换，**桌面版本尚未交付**。
