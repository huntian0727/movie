# 2026-10-08 公众发布安全加固

## Context

从已获取的最新 `origin/main`（807c495）开始，使用 `ai/public-release-audit` 分支。开发前完整存档：`2026-10-08_01-49-50-638_public-release-audit`；SQLite quick_check 成功。checkpoint 是恢复点，不是发行版本。工作区维护工具已校验最近三份开发存档及三份迁移备份，未删除任何文件；维护工具不属于本仓库。

用户授权修复、测试、文档、工作分支推送和 PR；禁止直接更新 main、发行 Tag、公开 Release、覆盖真实资料库或视频。正式开源/发行许可、签名及高风险产品策略由所有者决定。

## Changes

- 本地永久删除增加 enabled source、reparse/真实路径、身份和版本检查，以及独立暂存和无覆盖恢复。修复恢复碰撞、暂存替换、取消后远端拆批继续和重启自动推进问题。
- CloudDrive 快速清理持久绑定实际连接；未完成任务阻止切换账户，旧未绑定任务拒绝继续。报告区分元数据候选、完整 SHA 验证及当前快速删除，不将候选视为内容相同。
- 渲染入口改为受控 app-ui 协议，验证主窗口/播放器/时间轴角色、严格资源和媒体权限；损坏 DPAPI 凭据提供保留密文的恢复流程。
- 升级到 Electron 44.7.0、better-sqlite3 13.0.3 和配套构建链。N-API 官方预编译文件同时执行 Node/Electron 实际验证；为 npm 10.9.8 的 gypfile 安装问题增加保留真实生命周期脚本的锁定安装入口。
- 保留 electron-builder + NSIS，unsigned 身份、安装目录和资料库隔离。安装拒绝未知非空目录/旧危险卸载器；卸载仅删除明确拥有的文件，保留未知视频、SQLite 和子目录，拒绝 delete-app-data。
- Actions 固定版本 SHA；PR 执行真实无签名安装验收，公开上传仅含校验元数据。正式签名及上传要求受保护环境、所有者审批清单、源码授权、真实 Authenticode 和 SHA-256。
- 新增安全、贡献、法律材料、完整依赖/notice 清单、普通用户教程、干净 Windows 11 验收工具。LICENSE 是明确未授予许可证的占位；没有替所有者选择许可证。现有文档个人路径脱敏，保留完整 Git 历史。

全部修改路径见 [文件清单](../../public-release-changed-files.md)，具体风险和源码位置见 [发布审计](../../public-release-audit.md)。

## Verification

最终安装、桌面截图和产物身份将在实际执行完成后记录于本节，未执行项目不能计为通过。最终独立源码QA记录 PUBLIC-RELEASE-AUDIT-final-source-cross-qa.json 为 QA_COMPLETE / PASS_WITH_KNOWN_RISKS，本范围无新增可行动P0/P1；正式发布外部阻断项保持。代码提交c747ccf已推送工作分支，main未更新。

- 2026-10-08 北京时间最终 `npm run test:release-gate` **PASS**：lint（两个 TypeScript 项目）、完整 build、Windows 文件专项37项、迁移40项、性能专项31项、Node原生ABI127、完整131文件/1175测试，无跳过；全量测试323.61秒。性能fixture与查询恢复main原始单个60秒总截止，数据与全部查询断言保留。记录：本地忽略文件 `.tmp/public-release-frozen-all-gate.log`。
- 最终 `npm run test:electron-smoke` **PASS**：Electron44.7.0/ABI149、实际N-API SQLite完成标志、完整main-process smoke。记录 `.tmp/public-release-frozen-electron-smoke.log`。最终冻结源码的同一工作区实际lint/typecheck/test/build/Electron检查覆盖自动交付脚本全部实际存在的质量脚本；因此后续finish-and-push的SkipChecks仅复用已通过的等价检查（AGENTS允许），不删除、跳过或豁免测试。不适用的E2E脚本不存在，未声称执行。

- 最终renderer-security smoke通过实际三角色资源/typed bridge/媒体、DPAPI恢复和外部file/script/network及opaque origin拒绝，记录 .tmp/public-release-frozen-renderer-smoke.log。
- NativeHost默认及两份不同绝对路径实际编译逐字节一致，x64 managed PE SHA-256 215a49e9b9dee51ce758b7a9e1408db2e3a0704670ca349c0e314416554171d7；15项工具链对抗测试通过。编译器缓存不分发；未运行NativeHost/libmpv。
- 基线非 shallow Git：208 个可达提交、2116 个唯一历史 blob；Gitleaks 8.30.1 完整已获取历史及导出的当前源码零 secret 命中。另有 198 条元数据型隐私候选，报告不展示匹配原文。
- 全量及生产 npm audit 零已知漏洞；许可清单覆盖 428 项锁定依赖、75 项 runtime notice。
- 独立删除碰撞修复后 7 项对抗测试通过；删除/恢复专项合计 44 项。边界专项 96 项，真实 Electron 三角色、媒体/网络拒绝和 DPAPI 恢复通过。
- 已实际构建 Windows x64 unpacked，ASAR 3625 项及五种二进制验证通过；两阶段 packaged smoke 通过。最终 NSIS 守卫已通过真实安装器 smoke：拒绝未知非空目标、首次安装、带用户哨兵修复、拒绝 delete-app-data、卸载，内外及嵌套 SQLite/video 保持，正式注册项及快捷方式在两个 hive/registry view 下保持。孤立卸载命令专项18项、路径枚举专项17项通过。此前失败保留；最终提交后将重建相同源码候选复核。
- 保留全量失败记录：磁盘满、系统 commit 内存不足和D/C盘320k fixture准备超过60秒；初次批量SQL的REAL ID格式差异也由新增检查捕获并修复。既未删测试也未放宽断言、数据量或最终时间预算；最终C盘自有临时目录完整release gate通过。
- 稳定干净 Windows 11/no Node、上一正式签名版本升级、真实 CloudDrive 永久删除、真实 SMB/硬件破坏性验收：NOT_RUN。

## Risks and follow-up

正式公众发布结论：**FAIL**。即使工程门禁通过，仍不能公开分发未完成 GPL 对应源码材料的测试二进制，也不能将未签名候选冒充正式签名发行。

集中待决：代码权属及项目许可证、完整二进制源码/许可合规、签名证书（仅 Secrets）、快速永久清理默认策略/旧自动删除参数、历史资料公开范围、干净 Windows 11 及旧签名升级验收。正式环境目前只读查询返回 404，严格环境守卫会阻断；NativeHost 已采用固定官方编译器/引用及 deterministic/pathmap，两份不同路径产物逐字节一致；跨机器复现仍待Windows2025 CI验证。没有降低 hash 或签名门禁。

真实资料库、用户视频、旧生产桌面快捷方式和旧生产 package 均保持。所有破坏性测试使用自主创建的临时视频及真实 SQLite 哨兵。不同测试包 repair 不等于历史正式版升级。
