# 公众发布安全与 QA 报告

查询及审查日期：2026-10-08，Asia/Shanghai（北京时间）。仓库 [huntian0727/movie](https://github.com/huntian0727/movie)。实际起点为最新 origin/main 807c495；独立分支 ai/public-release-audit。审查源码、配置、迁移、测试及 Git，而非只读 README。

**正式公众发布结论：FAIL。** 工程修复可交付审核，但项目权属/许可、GPL 二进制完整对应源码、代码签名、真实干净 Windows 11 与历史签名版升级证据尚未闭环。unsigned-test-build 是私下工程验收候选，不能作为正式签名版本或批准公众分发的证据。

## 范围与数据保护

先创建 backup snapshot 2026-10-08_01-49-50-638_public-release-audit 和 checkpoint-20261008-094944-807c495-public-release-audit，再开分支。checkpoint 是恢复点，不是正式版本 tag。数据库备份 quick_check 通过。所有删除、媒体编码、IPC/DPAPI、安装/卸载测试使用合成临时数据；实际资料库和媒体没有参与破坏性测试。原生产桌面快捷方式及旧 package 未覆盖。

本地 Git 非 shallow，扫描全部已获取 refs：起点 208 个可达提交、2116 个唯一历史 blob。Gitleaks 8.30.1 固定官方发行 zip，SHA-256 d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e。git --redact=100 --ignore-gitleaks-allow --log-opts="--all --full-history --root" 扫描 207 个有 diff 的提交（空提交解释计数差异），零 secret 命中；当前全部 tracked/untracked 源码导出也零命中。最终提交后的复扫状态另见最终验证记录。

这不是没有泄露的保证：模式扫描另发现 198 个历史候选（91 Windows 用户路径、99 email-like、6 内网地址、2 credential assignment）。内网地址均出自测试合成端点；两条赋值来自 tests/main/logging.test.ts:32/121 的脱敏测试值；email-like中76条为 package-lock.json 依赖链接候选，23条为脚本/字幕等测试合成地址。Git 作者另有 3 个匿名身份，需权属确认。所有扫描记录只写文件/行/blob/规则，不记录命中原文。一个历史 ScanFailuresPage.tsx 含 NUL，按文本规范化再扫描并保留警告；不能将它忽略为二进制。

历史隐私示例：.agent/handoffs/TASK-SAFETY-001-qa.md:96（blob 54e6c62a77d583f34582a88e5537277b912dbdbe），docs/ai/START_HERE.md:7（ec09889f1896bbde0c8f309a009f3bb7aa9730be），docs/ai/deliveries/2026-08-18-fast-duplicate-permanent-delete.md:34（1db45a0e080a5e71791955a934f6b4d211b8e4e6）。当前约 45 份文档路径替换为 %USERPROFILE%，历史仍存在。真实媒体/目录叙述及统计需要维护者确认公开范围；没有删 Git 历史或扩大 allowlist。只覆盖已获取 refs；不可从本地扫描证明 GitHub 已删除对象、fork、Release、issue/附件无资料。

## P0/P1/P2 风险

| 级别 / 状态 | 具体位置 | 实际风险与处理 |
| --- | --- | --- |
| P0 / 当前未确认剩余 | 全仓库及已获取历史 | 未检出真实 Token/私钥。没有以零扫描结果冒充绝对无泄漏；未知 GitHub 隐藏对象不在证据范围。 |
| P1 / 已修复 | src/main/files/safePermanentDelete.ts:10/41；ipc.ts、scanFailureActions.ts | 通用永久删除原来仅依赖索引路径。现在绑定 enabled source，拒绝祖先 reparse/越界，复核 identity/size/mtime，独立暂存后 unlink；失败无覆盖恢复或保留暂存。 |
| P1 / 已修复 | src/main/media/duplicateCleanupService.ts，restoreStagedFile / processAuthorizedDelete | 恢复 stat→rename 可覆盖刚出现的新文件；保留副本 SHA 耗时期间暂存文件可被替换。现用 hard-link 无覆盖恢复、persisted identity 及最终 unlink 前版本检查。独立 QA 对运行期和启动恢复碰撞的两项临时文件复现先失败；最后keep哈希期间替换来自源码发现。修复后 7 项对抗测试通过。 |
| P1 / 已修复 | src/main/db/duplicateCleanupRepository.ts:43/55；duplicateCleanupService.ts:172/191/200；迁移015 | 快速 CloudDrive job 原未持久绑定账户，设置变化可能删另一账户同路径。现 main-only endpoint+token SHA-256 绑定每次 RPC、retry、resume，未完成任务阻止账户切换，旧未绑定 job 需清除并重建。 |
| P1 / 已修复 | duplicateCleanupService cancel/recover；clouddrive/mountedScanner.ts deleteCloudDriveFiles | 取消后递归拆批仍可能发送 RPC，重启自动推进破坏性任务。现 RPC 前/拆批重试检查取消，重启 cancelling→cancelled，其余 interrupted 需手动复核恢复。已发送服务端请求不能撤销。 |
| P1 / 已修复 | rendererProtocol.ts:19/50；security.ts:75/130/136；preload.cts | file: 渲染入口转为受控 app-ui://bundle，只服务 immutable build assets，拒绝 traversal/links；CSP/IPC角色与真实 frame 策略、permission deny、媒体 exact origin。真实 Electron 的 protocol Request 丢 Origin，因此不能只依赖 Request headers。 |
| P1 / 已修复 | settings/settingsStore.ts；cloudDriveCredentialStore.ts | DPAPI 损坏/迁移失败导致启动或环境 Token 回退风险。现公开恢复状态、关闭凭据及环境 fallback、非空替换后验证保存；不曝光真实 Token。 |
| P1 / 已修复 | package.json / lock；scripts/rebuild-electron.mjs | Electron33已不受支持，基线 npm audit 有34项（3 critical、23 high、8 moderate）。升级44.7.0/SQLite13及构建链；当前 full/prod audit零已知项。N-API用官方预编译并实际验证，不强制旧 ABI rebuild。 |
| P1 / 已修复 | build/installer.nsh；scripts/release-engineering.mjs / run-installer-smoke.mjs | 原 NSIS 递归清理/删 userData 与旧危险升级。现精确 owned-files 清单、非递归清理、禁止 delete-app-data/reparse/未标记旧卸载器；全套合成哨兵验收保留。 |
| P1 / 未解决，原生媒体安全阻断 | package.json:53/54；src/main/media/cacheService.ts:19；metadataService.ts:50 | 实测FFmpeg6.1.1/FFprobe4.0.2落后于官方后续安全修复，npm audit不覆盖EXE；确切补丁/启用库适用性未闭环，未声称漏洞利用已复现。应替换为同套维护中且源码/许可可核验的构建并重跑媒体与安装验收，详见 [二进制安全审查](legal/native-binary-security.md)。 |
| P1 / 未解决，阻止公众发布 | LICENSE；docs/legal/RELEASE-COMPLIANCE.md；dependency-inventory.json | 未确认代码权属与项目许可证。LICENSE仅明确未授权占位，不授予MIT/Apache。实际 FFmpeg6.1.1、FFprobe4.0.2 均 GPL；完整对应源码/所有静态库构建材料未闭环，旧probe来源已停运。 |
| P1 / 未解决，阻止正式发布 | build/release-approval.json；windows-release.yml | 无签名证书/批准发布者、干净 Windows11/noNode 与历史 signed upgrade 实测。默认fail closed；不能把本机Insider开发环境、同包repair或CI WindowsServer当验收。 |
| P1 / 已修复，跨机器仍待验收 | scripts/build-native-player.mjs；native-player-toolchain.lock.json | 改用锁定官方 NuGet Roslyn 编译器和六份 .NET4.8 引用，验证归档及全部缓存 hash、拒绝重解析点和额外加载文件，显式 deterministic/noconfig/nostdlib/pathmap。两份不同绝对路径实际编译逐字节一致；未放宽正式输入hash门禁。Windows2025跨机器复现尚未验证。 |
| P1 / 未解决，发布治理 | GitHub public-release environment | 实时只读API返回404，当前不能证明保护环境已配置。正式job新增强制API检查required reviewers、禁止self-review/admin bypass、仅v* tag部署策略；未配置即失败。没有擅自创建宽松环境或改变仓库权限。 |
| P1 / 待产品决策 | src/main/ipc.ts:655/658；DuplicateGroupsPage.tsx；duplicateCleanupService.ts:91 | 当前cleanup submit入口默认快速清理按规范化名称+大小与keep计划直接永久删除，不是整文件SHA相等证据。旧 duplicateFastDelete handler（ipc.ts:633）已直接拒绝，并非现行删除入口。UI已有明确永久确认，但公众默认是否需opt-in/更强确认需owner决定；隐藏legacy autoDeleteAfterVerification兼容参数也须策略审查。未偷偷换默认或关闭检查。 |
| P2 / 保留并说明 | safePermanentDelete / duplicateCleanupService | 同权限恶意进程最后文件系统调用竞态不能由路径检查彻底消除；hard-link 不支持时保持暂存待人工恢复，异常退出暂存文件可能需人工恢复。 |
| P2 / 待维护者确认 | docs/ai、.agent、Git作者 | 历史身份路径/真实资料库叙述仍在可达历史；受控历史清理必须另行批准，简单删当前文件无效。备份/旧迁移明文恢复材料须按用户权限保护。 |
| P2 / 待完善 | electron-builder.yml、NativeHost、旧升级流程 | 当前Electron默认图标；安装替换不是事务式回滚，失败可能需人工修复。播放器libmpv不是本包分发内容，兼容性依赖用户另装。 |

## 删除实现与确认

duplicateFastDelete 的分组/keep 排序、data-table永久删除与扫描失败入口均检查实际源码。快速流程不应宣传“内容相同”；资料库索引必须属于当前 enabled source。CloudDrive provider identity/path 都在 main 解析；返回值、取消、部分RPC失败和恢复状态不能只依赖UI消息判断。workflow2 完整 SHA 复核必须在已暂存删除副本、有效keep及最终stage identity一致后才unlink。workflow3 快速远程计划不声称 SHA 验证；账户哈希不经preload传出。

允许的 IPC、main/player/timeline 角色、sandbox/contextIsolation/nodeIntegration、preload typed bridge、CSP、窗口导航、shell外链白名单、媒体文件访问、CloudDrive URL/凭据、字幕网络入口均经过源码和专项测试审查。已受信 main 中的 XSS 仍可调用该角色允许的IPC，角色检查不能代替用户意图确认；没有写“XSS无法永久删除”的虚假保证。默认无后台遥测；用户启用CloudDrive/在线字幕或外部播放器时才触发相应网络/进程调用，日志和诊断可能含媒体路径，公开前应脱敏。

## 依赖与权属

lock inventory 覆盖428项（75 runtime），license表达式、resolved/integrity、文本及SHA都有记录。75 runtime 的notice均汇总；两个代理依赖发布包缺license文本，通过官方精确tag README的MIT段补齐并保留来源hash；parse-cache-control需人工确认BSD notice，不凭缺字段猜许可。平台开发依赖含MPL/Python等，详见JSON。

NativeHost编译工具另见 [独立许可/来源清单](legal/nativehost-toolchain.json)，不属于npm audit覆盖；官方NuGet注册记录和漏洞feed未包含这两个包的条目，不代表所有编译器依赖均无漏洞。编译器/引用缓存不进入安装包，两份路径构建SHA-256均为215a49e9b9dee51ce758b7a9e1408db2e3a0704670ca349c0e314416554171d7。

FFmpeg SHA-256 04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00，FFprobe SHA-256 4303ec85855340689b1f8aa5d9c1dc06ef3e3090682de3034edc3fca2b0798d5。ffmpeg-static wrapper自身也是GPL-3.0-or-later；不能仅讨论子进程隔离就略过wrapper义务。二进制 README 指向部分上游commit不等于所有对应源码齐全。

建议候选：若权属清晰且需简明授权，可审查MIT；若需明确专利授权，可审查Apache2。应用自有代码许可证与GPL二进制分发合规分别确认；组合兼容性需实际法律评审。未擅自决定许可证，也没有声称软件开源已经完成。

来源：[Electron44.7.0](https://releases.electronjs.org/release/v44.7.0)、[官方支持政策](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)、[SQLite13 N-API](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0)、[npm安装缺陷](https://github.com/npm/cli/issues/9837)、[FFmpeg法律说明](https://ffmpeg.org/legal.html)、[MIT文本](https://choosealicense.com/licenses/mit/)、[Apache2文本](https://www.apache.org/licenses/LICENSE-2.0)。

## 验证记录

冻结所有功能源码后root同一工作区 `test:release-gate` **PASS**（2026-10-08，北京时间）：lint/typecheck、完整build、Windows文件37项、迁移40项、性能31项、Node原生ABI127、全量131文件/1175项，无跳过。全量329.49秒；320k准备及全部查询恢复main原始单个60秒总截止并通过。最终实际Electron44.7.0/ABI149完整main-process smoke **PASS**，运行器同时要求SQLite native-completed和完整smoke完成标记。此前失败记录仍保留。

独立QA JSON位于 .agent/handoffs/PUBLIC-RELEASE-AUDIT-*-cross-qa.json；限定scope均为PASS_WITH_KNOWN_RISKS，不是整个公众发布PASS。完整门禁、打包、NSIS、本地UI最终状态在本节后续记录；未执行项必须保留NOT_RUN，失败不得作为通过。

保留的失败过程：旧契约断言、磁盘满、系统commit内存不足，以及D/C盘320k准备分别75/98秒超过60秒。曾试分离beforeAll与查询，最终已撤销分离，恢复main原始单个60秒总截止。最终fixture改为同一生产数据库、同一事务中的32批INSERT SELECT，保留全部26字段、逐行索引/FK/revision触发器及插入顺序；新增每批10000行、总320000行、100来源各3200行、rowid/id及revision严格校验。初次REAL绑定生成ID小数后缀被新增断言捕获，修正INTEGER seed后专项通过；最终单一60秒形态已在完整release gate实测通过。所有失败均保留，未删测试、减少数据、禁用索引/trigger或放宽2/3秒查询预算。

本机为Windows11EnterpriseInsiderPreview26220，有开发工具；无WindowsSandbox可用，Hyper-V VM查询无权限，连接器不可用。实际干净稳定Windows11/noNode测试 **NOT_RUN**，提供PowerShell验收工具但不冒充已执行。无旧正式签名升级样本 **NOT_RUN**。没有真实CloudDrive永久删除或SMB/物理卷破坏性实机测试 **NOT_RUN**。

已实测：D盘isolated lock安装通过，真实Electron44.7.0/full main-process smoke通过；package:dir、五种目标二进制/ASAR/法律材料验证及两阶段packaged smoke通过。系统空间恢复后NSIS已实际构建，Authenticode明确NotSigned。前两次首次安装返回失败，先修复空目录存在判断，再定位NSIS插件改写GetLastError导致误拒绝；现原子捕获错误码的守卫专项通过空/标记/非空/junction/missing临时夹具，最终孤立注册项守卫补齐后已实际重建，并通过完整 installer smoke：拒绝未知非空目录、首次安装、合成用户文件存在时 repair、拒绝 delete-app-data、卸载及 SQLite/video 哨兵保持，正式注册项/快捷方式保持。HKCU/HKLM 32/64 view 守卫拒绝没有同 view InstallLocation 的卸载命令，拒绝非固定无额外参数命令；只读临时注册项矩阵18项通过，未执行旧卸载器。最终已提交源码候选将再构建并验证，最终校验和另行记录。

## 待决事项及用户教程

1. 确认全体代码/图标权属并选择项目许可证（暂缓/MIT/Apache2等）；GPL source材料另行审批。
2. 提供已获授权的签名发布者、GitHub Secrets名称和证书方案；不要发送证书密码/私钥到聊天或仓库。
3. 确认公众快速永久清理的默认策略和强确认方案，以及旧workflow自动删除兼容策略。
4. 安排一次真实干净Windows11/noNode及上一正式签名版升级验收，审查历史个人资料公开范围。

普通用户完整步骤见 [Windows安装教程](windows-installation.md)：下载/哈希/签名核验、独立测试包安装、导入目录、SQLite备份、升级隔离限制、卸载数据保留及故障处理。正式安装包当前不存在批准的公众下载入口。


## 最终已提交源码产物与桌面验收

最终功能源码提交：d7e69072a1b7e944c23f86c140b3ab88283c0542。root干净工作树713份文件逐字节复制并验证到D盘隔离打包工作树；D工作树Git HEAD仍为807c495，明确设置GITHUB_SHA为经验证的root源码提交，不把D的HEAD冒称已更新。后续交付说明/截图提交仅含文档，功能输入保持不变。

Windows x64的最终dist:win、artifact、release:metadata、packaged smoke、installer smoke全部实际PASS。ASAR3625项，better-sqlite3 N-API、FFmpeg、FFprobe、NativeHost及Electron皆验证目标平台/字节；应用版本0.1.15、ProductVersion0.1.15.0、测试产品名正确。安装/repair/卸载以及明确delete-app-data拒绝完整通过，内外及嵌套SQLite/video哨兵和正式注册项/快捷方式保持。实际installer、application、NativeHost均NotSigned，未冒充签名版本。

产物目录：D:/CodexReleaseAudit/movie-public-release-package/release/unsigned-test-build。安装包：拉面影视-0.1.15-x64-unsigned-test-build-Setup.exe。

SHA-256：db75ff59908c4a4e199fdd074ab8227b2c9552e847fd5f65d86e4fe53b68edcc。同目录SHA256SUMS.txt/build-metadata.json记录实际签名、版本和二进制校验。app.asar SHA-256为0d79e615cebacdd88651756479086b3df1ce793ad492198f0f2413e98c7f7d59。

新桌面快捷方式为%USERPROFILE%/Desktop/拉面影视-unsigned-test-build-发布验收.lnk，目标是上述目录的win-unpacked/拉面影视-unsigned-test-build.exe；实际从该快捷方式启动。源码提交15:37:54、app.asar15:39:19、启动15:42:05（北京时间），来源一致。真实UI验证unsigned标识、app-ui入口、合成资料库/资产中心/视频、空状态修复、永久删除警告打开后取消；退出后合成SQLite quick_check为ok、视频仍1个。新测试快捷方式复用时核对目标及自身hash；旧正式快捷方式不变。

最终截图见screenshots/public-release-library.jpg、public-release-delete-warning.jpg、public-release-duplicate-empty.jpg，全部来自当前测试包的合成资料。实际无CloudDrive任务，未声称远端永久删除确认或服务端删除已验收。最终运行证据见.agent/handoffs/PUBLIC-RELEASE-AUDIT-final-runtime.json。正式公众发布仍FAIL。

## 最终交付文档提交前的历史复查

PR首轮实际Windows CI run37747001533的完整回归为FAIL：1174/1175通过，32万行性能测试总准备和查询约71.154秒超过原60秒；查询本身243.34/888.65/550.48ms均在原预算。依赖检查、Electron主进程/渲染安全及全历史安全CI已PASS，安装CI被依赖失败阻止，未冒充执行。后续修正仅将两个工作流现有完整release gate的TEMP/TMP设为GitHub runner.temp，使用运行器临时存储；原测试和全部断言/预算不变。修正的CI验收结果另以PR检查实际状态为准，不将候选修正直接当作通过。

2026-10-08交付文档提交前，实际导出211个可达提交、2288个唯一历史blob和715份当前文件；当前树Gitleaks使用完整脱敏且不接受仓库allowlist，结果零secret命中。隐私规则累计260条候选：91条Windows用户路径、155条email-like、12条private-network、2条credential assignment。基线198条的分类及公开范围风险保持；新增62条逐类复核如下，未将候选原文或密钥写入报告。

- 52条是上游公开许可证或版权声明中的联系地址：docs/legal/THIRD-PARTY-NOTICES.txt共50条；docs/legal/upstream/agent-base-6.0.2-LICENSE.txt:6和https-proxy-agent-5.0.1-LICENSE.txt:6各1条。保留法律归属材料，不把它们当作用户私人联系方式删除。
- package-lock.json:526/1554/2565/4654共4条来自上游glob弃用说明中的公开维护者联系方式，不是registry URL，也不是应用凭据。弃用版本属于维护风险，零npm advisory并不消除弃用说明；它们没有构成新secret泄露证据。
- tests中的4条private-network是固定合成端点：cloudDriveCredentialStore.test.ts:163、cloudDriveSecurity.test.ts:90、SettingsPage.test.tsx:122/126；不是实际用户配置。
- docs/legal/nativehost-toolchain.json:61/62的2条private-network是NuGet官方漏洞索引URL中点分日期造成的规则误报，不是内部网络地址。

3个Git作者身份仍需权属审查。历史中的2个JPEG和当前3张截图均为合成应用验收资料；当前截图仅保存应用窗口。此处记录提交前已完成的检查，最终文档提交后的完整refs与当前树Gitleaks复查另保留本地脱敏日志，并由PR安全工作流继续执行；不把尚未执行的检查写成PASS。

## 2026-10-08 继续接手补充审计（原工程结论不被覆盖）

复核家用机 MP2T8QB5 的本地干净分支与 PR #24：接手起点 `8c51e934ac4a91806138aff03f0b1f4e0cc47f45`，远端同一提交、`main` 仍 `807c49585d18c901b199fe0d3d8b0dbf31eb4114`，Draft 不合并。新备份 `2026-10-08_15-13-01-454_public-release-handoff-continuation` 的合成检查 SQLite quick_check OK（实际备份数据库约 0.87 GB、345892 条索引记录）。前述已通过 CI 和 NativeHost 跨机器 hash 结论继续有效，原始失败 run37747001533 继续保留。

| 优先级 | 本轮状态 | 说明 |
| --- | --- | --- |
| P0 | 没有发现新的可证明 P0 | 不以旧 secret 扫描零命中证明历史所有个人信息已有公开授权；本轮没有授权改写历史 |
| P1 | 候选二进制来源/版本校验 **PASS**，正式替换/授权 **未完成** | 锁定 BtbN Win64 LGPL 同构建二进制与 ZIP 精确 SHA，实测媒体 probe/生成封面/时间轴成功；原应用仍用旧 FFmpeg 6.1.1 / FFprobe 4.0.2。未拿齐全部启用库完整源码、补丁、构建材料和 notices；GPL JavaScript wrapper 仍需单独审查，详见 `docs/legal/native-binary-security.md` |
| P1 | 发布环境仍 **FAIL** | 实际 GitHub API 查询 `public-release` 404；GitHub collaborators 当前仅拥有者，无法完成独立 reviewer 审批。未创建自审/绕过环境；证书及批准发布者不存在 |
| P1 | 永久删除产品行为 **待决定** | `duplicateCleanupSubmit` 仍是现行快速清理入口，旧 `duplicateFastDelete` 禁用不代表此逻辑关闭；没有未经确认变更默认行为 |
| P1 | 干净 Win11/noNode 和旧正式签名版升级 **NOT_RUN** | 两台在线电脑均不能凭开发环境或 Windows Server CI 冒充独立干净 Win11/历史升级验收 |
| P2 | 历史隐私/版权身份 **待审** | 尚未得到维护者同意改写历史；没有清理或重置其他人的成果 |

新增 `scripts/verify-native-media-candidate.mjs`、来源锁定文件和 5 项测试；候选脚本已加入完整质量门禁。候选二进制及证据仅在本机 D 盘隔离审计目录，**没有替换、重建或上传任何新的 Windows 安装器**；此前已验收 unsigned 安装器仍为原始 SHA `db75ff59908c4a4e199fdd074ab8227b2c9552e847fd5f65d86e4fe53b68edcc`（接手后已重新哈希，Authenticode 实测 NotSigned），新候选不能沿用旧包的安装器测试作为自己的通过证据。

本轮首次本地 release gate **FAIL**：Vitest 意外纳入 `node:test` 新文件，原有 1175 项单测通过但多一个无法由 Vitest 加载的 suite（131/132 files）。原样保留 `.tmp/handoff-20261008-release-gate.log`。将新增测试更名为 `.node-test.mjs` 并保留为 `node --test` 明确执行后，完整 `test:release-gate` **PASS（退出码0，131 文件/1175 旧测试加5项新测试，无跳过，Vitest 阶段320.88秒）**；Electron 主进程 smoke **PASS**、renderer-security smoke **PASS**。全部实测日志本地忽略目录，首轮失败没有从记录中删除。

需要维护者集中确认的权属/许可证、签名/独立审核、永久删除默认与旧参数、隐私公开范围和旧正式升级样本，单独记录于 [公众发布决策清单](public-release-owner-decisions.md)。**工程验收 PASS_WITH_RISKS，正式公众发布 FAIL；所有审批字段保持失败关闭。**

## 2026-10-09 默认安全策略落地（当前 PR 继续评审）

维护者已批准“默认安全、技术由工程处理”的保守方案，**没有授权许可证、正式发行和真实资料删除测试**。现行应用 UI 已改接 `onSubmitCleanup` 完整 SHA-256 校验，快速单项/当前页/筛选全集元数据删除入口不再对正常用户提供；完整校验成功后，用户仍须在后台任务二次输入 `DELETE` 才允许永久删除。旧 `autoDeleteAfterVerification=true` 直接拒绝；`submitFiltered` 及已有 workflowVersion=3 的 resume/retry/replay 在服务层拒绝，pump 再拒绝启动版本3任务，防止重启旧未完成快速任务意外执行。**快速元数据删除整个模式暂不可用**，未来 opt-in 需要独立设计和授权，绝非默认开启。未修改允许更改主数据、视频或批准发行的代码。

安全测试/本轮最新实际结果见 `docs/ai/deliveries/2026-10-09-public-release-safe-delete-default.md`。虽然此项产品默认策略无需再等维护者逐项选择，其他发布阻塞——代码/图标权属、MIT/Apache 最终授权、完整 FFmpeg/FFprobe 对应源码与 wrapper 许可、签名及独立 reviewer、干净稳定 Win11 与历史签名版升级、历史个人信息公开范围——保持。**正式公众发布仍 FAIL。**

## 2026-10-09 FFmpeg/FFprobe 实际更新至同套原生 LGPL 构建

本工作分支的应用及隔离 unsigned 安装器不再包含 GPL `ffmpeg-static` JS 包装层和旧 FFprobe 4.0.2；通过严格的 ZIP/EXE SHA 检验与原生 `media-tools` 路径引入同套 FFmpeg/FFprobe 9.0.2-22。针对性媒体与许可证测试通过，完整 `test:release-gate` 第一次 PASS，Electron main、renderer-security、`dist:win`、`verify:artifact`、`release:metadata`、`test:packaged-smoke` 和 `test:installer-smoke` 实际 PASS。第三方 build-recipe 与 FFmpeg 主源码快照实际下载、哈希，43 个启用外部库均已定位到至少一个候选 recipe（其中 4 个需映射别名，未审查完整源码/许可）。**P1 仍然阻断公众发行**：外部库完整对应源码、补丁与授权、静态链接条件及安全补丁适用性、产权声明、签名/独立审核、干净 Win11 历史升级未闭环。全局结论工程 PASS_WITH_RISKS / 公众发布 FAIL；未合并 main、未创建正式 Tag/Release。最新详见 `docs/legal/FFMPEG-SOURCE-CANDIDATE.md` 及 `docs/ai/deliveries/2026-10-09-media-binary-wrapper-removal.md`。

最终复测（本轮迁移）：`test:release-gate` **PASS，132 files / 1182 tests，附加5项原生工具契约测试 PASS**；旧测试脚本断言的首次失败仍保留于交付文档。原生工具由精确 SHA 的隔离候选提供，旧 GPL JavaScript wrapper 和 FFprobe 4.0.2 不再编入新测试包。**所有外部库许可/源码和长期可复现来源未放行，公众发行 FAIL**。

## 2026-10-09 家用机恢复连接后专项取证

家用机 MP2T8QB5 已恢复连接，本轮**只使用 B5，不使用办公机 707**。接手工作区干净，基线 `db8d61908008a1e9d940ce9cef7039d06e346d6d`，PR #24 仍 Draft，main `807c49585d18c901b199fe0d3d8b0dbf31eb4114`。修改前创建完整 checkpoint + SQLite 快照并通过 quick_check，参见本轮交付记录。

本轮新建 fail-closed 的上游源码 recipe 审计程序，已核实 43 项启用外部库/44 份候选 recipe 引用及固定修订、初步直接依赖和 4 份补丁哈希；精确版本 opus/libass 两份 COPYING 原文也已归档在 B5 隔离审计目录。证据见 `docs/legal/native-media-recipe-evidence.json`。**正式公众发布仍 FAIL**：这不是二进制/完整源码、许可证/静态链接义务、干净 Windows、签名审批通过的证明。新增代码没有修改 Electron 的功能与安装器，原已验收包的 SHA 和部署状态仍保持历史记录，不宣称新包交付。

上述 FFmpeg 取证本轮后续核验补充：先前 Opus TAR 下载首轮网络超时，但 CURL 自动重试最终完整成功；libass TAR 也成功，在 B5 经完整 TAR 列表退出码 0 和 SHA-256 验证。故目前外部库已独立存档 **2/43 份完整源码归档**，其余 41 项及传递依赖、全部许可证/补丁适用性和二进制对应仍未验收。这不代表可以公开分发。

## 2026-10-09 上游源码根目录许可证证据批量核查

本轮只在家用 B5 工作树增加一项针对 GitHub **精确 Commit** 的许可证原文归档工具，结合上轮已确认的 43 个启用库、42 个不同来源仓库：GitHub 29 个仓库的根 LICENSE/COPYING/COPYRIGHT/NOTICE/AUTHORS 候选均已通过实际 API 与 Git blob SHA-1 核验，取得 49 份根文件和对应 SHA-256；无失败。29 个仓库的根文件可审查，不等于 29 个库的许可证/源码法律闭环，也不等于全部 42 个仓库。余下 13 个非 GitHub 仓库、源码 TAR（目前独立验证 2 份）、传递依赖、实际二进制构建关联、静态 LGPL3 对应源码/重新链接义务仍是正式发行 P1 阻塞。见 `docs/legal/NATIVE-MEDIA-LICENSE-EVIDENCE.md` 与 `native-media-license-availability.json`。正式发布 FAIL，`build/release-approval.json` 不变。

## 2026-10-09 免费分享决定及许可证落地

维护者明确要求个人纯免费分享、无商业化计划、最简化发布。已替换根目录 `LICENSE` 为 MIT 正式文本（版权 `huntian0727`），并更新 `package.json.license` 与 `package-lock.json` 项目授权字段、README。现有 `build/release-approval.json` 的 `applicationLicense` 与 `licenseSha256` 同步，但**保持 `approved:false`、`ownersConfirmed:false`、第三方二进制授权 false、手动验收 false**。MIT 仅覆盖拥有权利的项目自有代码，不改变 FFmpeg/ffprobe/外部库许可。用户已批准**首发不购买证书**，正式公众未签名包通道尚未实现。已有 unsigned-test-build 仍为内部 QA 身份，不能作为正式公众安装器上架。本次未修改用户应用、视频、SQLite 或现有快捷方式。

## 2026-10-09 FFmpeg Lite 真正打包、安装 QA 进展

以固定 FFmpeg/FFprobe 8.1.2 LGPL2.1 构建替代源作为**显式隔离 QA 变体**，相较原 43 个可选库的 BtbN 候选，这个 Lite 构建启用两项明确外部 FFmpeg 库 `libvpl`、`libopenh264`，并含五份动态运行 DLL。精确 27,486,819 字节的源发行归档 SHA-256 和 13 个输入文件的独立 SHA 全部核对一致。选择 `MOVIE_MEDIA_VARIANT=lite-candidate` 才切换 QA，未选择仍走原受测路径；正式 signed release 拒绝 Lite。

**真实家用 B5 测试已通过**：源文件与 PE 完整性验证、合成 MP4/MKV ffprobe、缩略图/JPEG、Electron `package:dir`、`verify:artifact`、`test:packaged-smoke`、NSIS `dist:win`、`release:metadata` 和 `test:installer-smoke`；真实安装/修复/卸载/删除数据参数拒绝，合成视频和数据库哈希不变，正式应用登记与桌面快捷方式无变化。内部 QA 安装包 137,020,508 字节，首次产生时 SHA `0314a5f6bcbabe701ac62dad3852f424f7efa0f276de8f4b4c312426e72e175f`；后续若按提交版本重建则重新核对 SHA，旧 BtbN QA 包已备份于 B5 隔离 D 盘目录。详见 [FFmpeg Lite 验收](legal/FFMPEG-LITE-QA.md)。

**公众分发仍未批准**：上游 `SOURCE.txt` 引用的 `GCC-RUNTIME-LIBRARY-EXCEPTION.txt` 在实际分发压缩包中缺失；对应源码/动态 DLL 许可与静态 LGPL 义务须处理；真正干净 Win11 和历史升级未完成，未签名公众正式发行身份尚未创建，内部 QA 包不得当公众安装包。

## 2026-10-09 未签名社区安装身份和固定源码取得

在家用 B5 上已预备独立的 `unsigned-public-release` 构建档案（独立 appId、NSIS GUID、userData，**不更新旧版**）。无签名证书，必须以明确的 GitHub 版本 Tag、发布条件、源文件和所有 8 件原生二进制及干净 Win11 证据 SHA 共同授权；实际模拟 `RELEASE_LICENSE_APPROVED=true` 等发布环境变量但仓库 `build/release-approval.json.approved=false`，**构建退出非零、正确停止在 owner 审核**。独立社区版尚未生成，也未上架。FFmpeg 8.1.2 完整主源码 11,710,924 字节及固定 tag 构建脚本 32,279 字节，均已私有归档且 SHA 和 TAR 完整性验收通过。详见 `docs/legal/FFMPEG-LITE-QA.md`、`docs/release-workflow.md`。

## 2026-10-09 FFmpeg Lite SBOM 与 Windows CI 证据闭环补充

本轮针对 GitHub [Windows CI 37913880108](https://github.com/huntian0727/movie/actions/runs/37913880108) 的**实际失败**进行了有范围的修复。上次 CI 1186/1188 通过，两个失败为（1）耗时多次外部 Git/PowerShell 的 Web Advisor 测试在默认 5 秒后超时；（2）GCC Runtime Library Exception 原始文本经 Git CRLF/LF 转换，CI 中 SHA-256 与家用电脑取得的证据哈希不一致。通过仅把该外部进程测试预算设为 40s，以及将 `docs/legal/GCC-RUNTIME-LIBRARY-EXCEPTION.txt` 设置为 `-text` 禁止换行规范化，实测 Git **暂存对象 SHA 与原始 Windows 文件 SHA 完全一致**，都是 `9d6b43ce4d8de0c878bf16b54d8e7a10d9bd42b75178153e3af6a815bdc90f74`。没有跳过断言或修改全局超时设置。

追加 [FFmpeg Lite SPDX 2.3 清单](legal/FFMPEG-LITE-SBOM.spdx.json)：读取家用 B5 的精确 13 个固定归档条目和两个本地衍生证据文件，逐个核对真实字节 SHA 后生成**7 件原生二进制**对应包和文件哈希（FFmpeg、FFprobe、五个 DLL）。新增可复现脚本 `npm run release:sbom-lite`，在 Lite 安装器的 `release:metadata` 流程自动附带同源 SBOM 及 `SHA256SUMS.txt`。本轮未重新创建/批准正式安装包；这只是发布元数据能力。详见 [二进制—源码映射](legal/BINARY-SOURCE-MAP.md)、[第三方声明索引](legal/THIRD_PARTY_NOTICES.md)。

所有未知 MSYS2 包精确版本、源码构建关联及许可证结论仍明确记为 `NOASSERTION` / `EXACT_MSYS2_PACKAGE_AND_SOURCE_NOT_VERIFIED`。**不因为有 SBOM 就修改 `build/release-approval.json.approved=false`**，不公开上传尚未满足对应源码/许可和独立干净 Windows 11 QA 的安装包。

## 2026-10-09 FFmpeg Lite 四份依赖对应源码取得（新增最终证据）

在家用 B5 上从 MSYS2 可信同步镜像完整下载四份精确版本源码压缩包并校验，来源对应已锁定四份二进制包和五个 DLL；对应 PKGBUILD **4/4 字节哈希等于二进制包 BUILDINFO 配方**。建立 `scripts/audit-native-msys2-sources.mjs`、`docs/legal/MSYS2-EXACT-SOURCE-EVIDENCE.json` 和源码合同测试。原来的“MSYS2 源码包仍未下载”阻塞项现已关闭；最终 LGPL 适用性、源码随 Release 提供、干净稳定 Win11 QA 和 owner 批准仍未关闭。用于最终审核的完整源码材料 ZIP 暂存家用 B5 D 盘，不可当正式发行许可证。
