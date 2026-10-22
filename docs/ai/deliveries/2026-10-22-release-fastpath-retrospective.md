# 2026-10-22｜v0.1.16 正式发版经验归档

本文件作为下一次发行的历史证据，下一次程序员应优先读 docs/RELEASE_FASTPATH.md。

## 最终确认的事实

- GitHub 公开 Latest：v0.1.16，https://github.com/huntian0727/movie/releases/tag/v0.1.16
- 正式发行 Commit / 解析后的 Tag：159db20738d4e36243fdcf57cc8997e41fbea818。
- 正式 ZIP：Movie-0.1.16-Windows-x64-Portable.zip；214780766 字节；SHA-256 fcf37f55e7c2cab21c051aaad0534560ca2f5007ebf163399648e0d4115fa703。
- Windows CI：39733324623，Security audit：39733324536，GitHub 正式 Source builder：39734209982；三者均针对同一 Commit 成功。
- GitHub Release ID：420326400；六附件为程序 ZIP、应用源代码 ZIP、Native 对应源码 ZIP、SOURCE-PAIR.json、SHA256SUMS.txt、RELEASE-VERIFICATION.json。
- 用户只要求未签名 Windows x64 绿色版；没有把 NSIS 安装器和完整稳定 Windows 多环境 GUI 测试作为本版交付范围；没有执行真实 CloudDrive/115 永久删除。

## 为什么会花这么长时间

1. **范围不断扩大。** 最初想简单打包，后来夹杂企业式许可门禁、安装器与复杂质量审计。改法：先锁定绿色 ZIP 范围，已经通过的测试不反复跑。
2. **发行状态混淆。** 本地日常桌面版、内部 QA、Beta、Draft、Latest 不是一回事。改法：每项明确 Commit、版本、快捷方式或 Release 状态。
3. **老库和新库的批准关系不清。** 新原生构建 39612312642 成功，并不代表这个新批次获公开再分发批准。最终方案复用以前已经批准的**字节一致**第三方库，只重新核对本版自有 NativeHost。
4. **证据版本绑定。** 0.1.15 的 release-approval.json 不能直接沿用到 0.1.16；package-lock、NativeHost、源码 ZIP、Review Evidence、GitHub Draft ID 都要求逐字节匹配。改法：把只读 release:check 放在打包之前。
5. **Windows 字节与短路径。** TEMP 的 RUNNER~1 路径导致 packaged smoke 超时；Git CRLF/LF 导致审批文件哈希与真实 Git 对象不一致。改法：canonical realpath、.gitattributes 与专项测试。
6. **QA 下载链接失效。** 曾依赖已删除的 BtbN 日期构建导致 404。改法：测试资产用固定长期 URI + SHA，不混入正式的对应源码分发库。
7. **旧测试断言仍绑定旧历史**：CI 要求以前 producer SUCCESS，但实际该旧批次是 FAIL，后来通过其他真实证据核验。改法：只更改断言以描述实际批次，不能伪造曾经成功的 CI。
8. **Draft ID → 审批 → Commit → tag 互相依赖。** 草稿创建可能先产生 tag，审批绑定 Draft ID 后又改变 Commit；必须在公开前锁定最终正确 SHA。改法：每步有唯一版本/提交/哈希，公开 tag 不移动。
9. **远端来源材料体积大**。 Native 对应源码 ZIP 超过 250 MB，绿色程序 ZIP 超过 210 MB；远端上传、校验和本地构建耗时会波动。改法：已批准且未修改的运行库/源码保留可复用材料，GitHub 原有 builder 在 Draft 里直接暂存最终 ZIP。
10. **先汇报进度而没完成目标**。 用户真正要求可下载的 Github Latest，而不是“CI 已通过”。改法：终态只有 GitHub Release Public + Latest + 完整附件和校验后才能宣布完成。

## 成功的最后一段发布链

- 从固定 Commit、已批准来源准备 Draft，上传精确 Application Sources、Native Sources、SOURCE-PAIR.json；
- 对同 Commit 跑完 Windows CI、安全审计；
- GitHub source-community-build.yml 手工 unsigned-public-release 构建正式 Windows ZIP 并上传到同一 Draft；
- 基于真实 GitHub 资产 SHA 补齐 SHA256SUMS 与 RELEASE-VERIFICATION；
- 一次性解除 Draft 并设 Latest，最后通过 GitHub API 核实下载文件，才向用户报告“发布成功”。

## 从此以后留下的可重复入口

- docs/RELEASE_FASTPATH.md：完整极简顺序和真实命令；
- docs/releases/RELEASE_NOTES_TEMPLATE.md：对比上一版且必须包含三类分类；
- docs/releases/NEXT-CHANGES.md：功能开发中直接记录，避免发布时重新回想；
- npm run release:note：自动追加按类别的已开发事项；
- npm run release:check：只读的 --version / --draft / --published 检查，提前暴露旧审批、换行哈希、旧 tag、缺附件和旧 CI；
- tests/scripts/releaseFastpathPreflight.test.mjs 与 tests/scripts/releaseRecordChange.test.mjs：覆盖版本、附件、GitHub 同提交 CI、记录分类及幂等。

## Context

用户需要下次正式发布 Windows 绿色 ZIP 更快，避免上一轮为了小版本反复执行完整重审与安装器流程；现有 v0.1.16 已是公开 Latest。这次属于**发布流程沉淀**，不增加播放器功能、不重新发布旧版，也不改变家里正在使用的程序。

## Changes

- 与已经提交的初始 SOP 合并为**唯一 docs/RELEASE_FASTPATH.md 入口**，避免两份相互冲突的发布手册；补上可直接复制的 GitHub 操作顺序和真实风险警告。
- AGENTS.md、docs/DEVELOPMENT_AND_RELEASE.md 与旧的 docs/OPEN_SOURCE_RELEASE_SIMPLE.md 指向唯一入口，修正曾声称 v0.1.16 未发布的旧状态。
- package.json 新增 release:note（安全/性能/功能增加类变更逐项记录）与 release:check（只读核对准备、Draft、Published 三个阶段）。
- 扩展 scripts/release-fastpath-preflight.mjs，核对真实对应源码批准、NativeHost 源码哈希、发行 ID、tag 当前 Commit、同一 Commit 的 GitHub CI 及六份带 SHA 的实际附件。
- 新增 docs/releases/NEXT-CHANGES.md、scripts/release-record-change.mjs 和 tests/scripts/releaseRecordChange.test.mjs；复用已有 docs/releases/RELEASE_NOTES_TEMPLATE.md，不另造第二份模板。

## Verification

- 两个发行辅助脚本的 node --check：PASS。
- 四个发行相关 Vitest 专项组（releaseFastpathPreflight、releaseRecordChange、releaseEngineering、sourceReleasePipeline）：PASS。
- npm run typecheck：PASS。
- npm run release:check -- --version 0.1.16：当前本地批准、文件哈希、三类说明核对通过。
- npm run release:note -- --help：PASS；为防污染下一版记录，未向真实变更日志写入虚构业务功能。
- Git diff --check：PASS。
- GitHub Published 终态若从本开发分支运行，会因 HEAD 已超前发布 Tag 而 BLOCK，这是**正确的防错机制**；单元测试核实旧 CI/错误 SHA 与缺附件不能冒充成功。
- 开发前备份：2026-10-22_06-41-41-185_release-fastpath-playbook（数据库 quick_check OK，未修改真实媒体）。

## Risks and follow-up

- 快速发布仅覆盖 Windows x64 未签名绿色 ZIP；不暗示已验收签名安装器、稳定 Win11 所有配置或真实网盘删除。
- draft / published 阶段必须在正式 tag 对应源代码检出目录运行。当前工作分支后续提交导致“不匹配”是保护机制，不能通过随意修改已公开 tag 规避。
- 若以后变更 FFmpeg、MPV 或 NativeHost 字节，仍需对**变化的那部分**真实核验许可证和对应源码；审批文件不能自动翻转通过。
- 本次纯文档和辅助脚本，不更新桌面显示版本号、无需重打包、无需创建新 GitHub Release。

本次工作**只改文档和发行辅助工具，不改用户运行功能、不重复发 v0.1.16，也不将旧 tag 重写**。日常版更新依 docs/ai/DAILY-DESKTOP-UPDATE-POLICY.md，GitHub 公共发行需要用户明确授权。
