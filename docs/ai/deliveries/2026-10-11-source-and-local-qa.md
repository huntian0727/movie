---
date: 2026-10-11
branch: ai/source-and-local-qa
type: docs
status: partial
---

# 候选源码快照与真实媒体补验

## Context

用户要求继续发布前收尾，选择本机沙盒测试，并提供沙盒桌面文件夹内的真实视频；长篇 MKV 和真实 1080p MP4 的声音分别获用户确认“声音正常”。保留沙盒与新提供的文件，不沿用此前清空沙盒的授权。

基准 `846861d96563362a38e13f3db8043065ca625a83`，开始时工作区干净，与 origin/main 一致。开发前快照 `2026-10-11_05-52-49-730_source-and-local-qa`，checkpoint `checkpoint-20261011-135245-846861d-source-and-local-qa` 已推送。真实资料库 345892 条、quick_check 正常。随后授权维护脚本核验最近三份开发和三份迁移备份，清理一份旧开发快照、错误 0。没有改动日常资料库或播放器实现。

## Changes

- GitLab 普通 TAR/ZIP 端点仍返回 HTTP 406；通过公开 commit-ref tree/blob API 保存 fontconfig 和 SVT-AV1 固定候选提交的源码，私人目录 `D:/CodexReleaseAudit/movie-gitlab-candidate-snapshots-20261011`。
- 两份本地 API 快照保存文件模式及符号链接，校验 2060 个 blob 文件路径、112 个非根子树、四份原始顶层通知、TAR 回读内容和 SHA。根树由提交引用目录清单计算，未与单独的原始 commit 对象比对；不称为上游签发的归档或当前 DLL 实际版本证明。
- 更新 [恢复清单](../../legal/MPV-DEPENDENCY-SOURCE-RECOVERY.json)、[89 目标清单](../../legal/MPV-SOURCE-GAPS-INVENTORY.json) 与 [缺口说明](../../legal/MPV-SOURCE-GAPS.md)，新增 [API 快照证据](../../legal/MPV-GITLAB-SOURCE-SNAPSHOTS.json)。合计 21 份候选归档、39 份顶层原始通知；原先 19 份归档目录保持历史记录。
- 在已运行的同一绿色测试 ZIP 上补验七份真实媒体，新增 [脱敏证据](../../QA/2026-10-11-sandbox-real-media-evidence.json)，同步稳定版验收方案与 Release 草稿。公开文档没有真实视频名称、路径、截图或数据库。

## Verification

- 独立复核两份源码 TAR、Git blob / subtree、文件模式、四份通知和私人 SHA256SUMS 的 10 个文件：PASS。89 个目标的原始字段与 HEAD 一致，仅 fontconfig / SVT-AV1 的候选恢复字段变化；发行审批文件和运行库锁逐字节与 HEAD 一致。
- 真实视频扫描新增七条、失败零条；SQLite 副本 quick_check 为 ok，10 个视频、2 个来源、10 条播放记录。七份真实样本元数据及编码探测 ready，无文件缺失；含四份 H.264 与三份 H.265，实际分辨率含两份 1080p、三份 1440p。
- 七份均有两次以上活动画面及前进时间；长篇 MKV、竖屏 MP4、真实 1080p 的暂停/跳转/恢复通过。长篇 MKV 与真实 1080p 的声音获用户分别确认；不把媒体编码探测或计时前进当成听音证明。
- 正常退出应用后通过资源管理器仅复制隔离 SQLite/WAL/SHM；宿主 Python 以只读连接分析副本，SHM 可由 SQLite 在副本上重建，不声称副本 SHM 与源文件哈希相同。重开应用后的 GUI 保留 10 个视频、2 个来源、10 条最近播放，元数据待处理/失败及扫描异常均为零；MKV 从保存的 20:03 恢复并出现前进画面，真实 H.265 从 01:31 恢复播放。没有重启或清空沙盒。
- 本轮使用已有锁定环境 Node 22.23.1 / npm 10.9.8，仅设置检查子进程 PATH。`npm run lint`、`npm run typecheck`、`npm run build`：PASS；`npm test`：134 个文件、1204 项 PASS；`npm run test:electron-smoke`：PASS，含 SQLite、三身份/DPAPI/移动文件夹重开、preload 和主进程；`npm run test:media-candidate-contract`：60/60 PASS。
- 独立 E2E npm 脚本不存在；这里分别记录真实 GUI 操作与 Electron smoke。构建体积提示和 PNG 色彩配置警告未导致失败。证据检查工具初次目录父路径计算、数据库来源列选择错误已修正并重跑通过，未改源码材料或程序实现来绕过检查。
- 最终独立核对八份待提交文档、29 个本地链接、七份脱敏参数与真实隔离副本、六项检查结果和原绿色 ZIP SHA：PASS。`git diff --check` 与交付脚本 ValidateOnly：PASS。待提交路径全部为 docs，没有数据库、真实媒体、缓存、日志或二进制。

## Risks and follow-up

- 这关闭了已解析候选源码的下载可用性缺口，未关闭实际 DLL 依赖版本、未变化缓存输入、完整链接组件、生成配置/工具链、完整通知覆盖及宿主组合审核；全部发行审批和 `distributable=false` 保持原值。没有 GitHub Release 或发行 Tag。
- 两台本地系统均为 Insider，沙盒默认账户不能代替稳定 Windows 11 普通用户验收；公众包身份和稳定版最终测试仍未完成。
- 真视频只部分播放，不是全片或长时压力测试；没有 4K 样本。封面/时间轴预览未逐份完成验收，副本中有 pending 状态；这些状态不证明失败，也不能声称全部预览通过。音轨确认逐份记录，未确认样本保持未确认，无音轨样本单独标识。
- 真实 H.265 样本 C 后续播放的总时长显示为 07:25，而已索引及标题为 07:48；已记录实际差异，尚未判断是源文件时序、运行库估算或应用行为，不能声称这份样本的总时长准确性已通过。
- 不在真实文件上做删除/卸载；原合成样片保留测试证据继续单独有效。本轮副本是隔离 QA 库，不是日常库备份；没有修改源视频。
- 本轮只修改文档/机器证据，不影响桌面行为，不重新打包。已有私人绿色包对应 `19465ef7500fb53c325a5079126497e1fe34cd57`，ZIP SHA `e52289cc4a50380d335c71601883ec78d556f726a228e08f38ad17c04a509228`；已在沙盒正常重开现有程序。正式桌面版本尚未交付。
- 完整等价检查、最终证据复核和交付脚本 ValidateOnly 已实际通过，可使用 `-SkipChecks` 普通推送功能分支和 main，保存 main 备份标签。
