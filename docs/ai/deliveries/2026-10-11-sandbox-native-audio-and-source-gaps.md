---
date: 2026-10-11
branch: ai/sandbox-native-audio
type: docs
status: partial
---

# 原生声音补验与发行源码缺口清单

## Context

用户要求继续本机验收。基准 `ad36066`，工作区干净，与 origin/main 一致；本轮补播沙盒 H.265/MKV，并将第三方材料缺口具体化，不修改应用行为或架构。

开发前快照：`2026-10-11_05-15-43-639_sandbox-native-audio`；checkpoint：`checkpoint-20261011-131539-ad36066-sandbox-native-audio`。真实资料库 345892 条，quick_check 正常。按授权核验三份开发快照和三份迁移备份后清理一份旧快照，错误为 0；真实资料库和视频未参与此次测试。

## Changes

- 在现有 Windows 沙盒中，通过文件资源管理器重新完整解压上一轮同一份 ZIP 到 `C:\MovieQA\Program-updated`，正常启动并重用沙盒的隔离 QA 资料库。没有重启沙盒或覆盖本机日常程序。
- 新增 [MPV 源码材料缺口](../../legal/MPV-SOURCE-GAPS.md) 及 [89 个构建下载目标的配方清单](../../legal/MPV-SOURCE-GAPS-INVENTORY.json)。输入归档和原日志均先核对既有 SHA，再解析目标并逐项记录配方文件 SHA。
- 没有把构建下载目标误作实际 DLL 链接清单；没有用浮动最新源码替代缺失的实际版本；没有修改发行审批或公开上传二进制。

## Verification

- 沙盒仍是 Windows 11 Enterprise Insider Preview 26100.9606；本轮未声明完成稳定版或普通非管理员用户验收。
- 测试 ZIP：`拉面影视-0.1.15-x64-unsigned-test-build-Portable.zip`，代码提交 `19465ef7500fb53c325a5079126497e1fe34cd57`，SHA-256 `e52289cc4a50380d335c71601883ec78d556f726a228e08f38ad17c04a509228`。
- 重解压后正常 GUI 启动，资料库仍显示 3 条视频、1 个收藏、3 条历史。H.265 和 MKV 均观察到活动彩色画面，原生解码标签可见，音量调低；H.265 播放结束后自动切换到 MKV；MKV 在末尾停止。
- 试听结束后从界面正常关闭播放器和主程序，保留沙盒、程序目录和隔离 QA 资料库；本轮没有再次执行移除程序测试。
- H.265/MKV 人工试听：等待用户对两份样片分别反馈，不能从画面或音量控件推断能听到声音。
- 源码材料清单校验：PASS。89 个下载目标均找到唯一固定配方，准确主源码归档已知 2 份；其余实际依赖版本/源码/通知仍未核实，不自动批准。
- 本轮 `npm run lint` / `npm run typecheck` / `npm run build`：PASS。
- 本轮 `npm test`：PASS，134 个文件、1204 项测试。
- 本轮 `npm run test:electron-smoke`：PASS，包含原生 SQLite、三身份/DPAPI/换目录重开、主进程和 preload；`test:renderer-security-smoke`：PASS。
- 本轮 `npm run test:media-candidate-contract`：PASS，60/60。
- `git diff --check` 及自动交付安全检查的 ValidateOnly：PASS；独立 E2E npm 脚本不存在，沙盒 GUI 回归实际执行如上。

## Risks and follow-up

- 声音确认的问题已发给用户；H.264 的上轮“能听到”反馈仍只适用于当时样片，不推广到原生播放器。
- 完整实际依赖版本、源码/补丁/通知、构建环境、宿主组合审核和公开交付路线仍缺；详见具体清单。仅添加材料追踪，不作新的法律结论。
- 正式审批保持 `approved=false`、`manualQaApproved=false`，各二进制源码审批 false。没有生成公众版或发布 GitHub Release。
- 本轮只更新验收和材料文档，无应用代码变化；不为文档提交重新生成二进制。原绿色测试入口保持原路径，正式桌面版本尚未交付。
- 完整等价质量检查通过并记录后，自动交付使用 `-SkipChecks`，普通推送分支/main，保存 main 备份标签。
