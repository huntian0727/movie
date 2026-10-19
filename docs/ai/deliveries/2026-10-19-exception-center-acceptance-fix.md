---
date: 2026-10-19
branch: ai/exception-center-acceptance-fix
type: fix
status: verified_pending_delivery
---

# 异常中心：大数据量隔离验收及来源统计修正

## Context

维护者要求完成异常中心三项最终验收：实际界面、隔离处理流程和大数据量性能。基线提交 42ee088 已发布到 GitHub main；只在家用电脑 MP2T8QB5 上作业，绝不在真实视频资料库上执行测试性删除、清理或批量复查。

- 开工分支 ai/exception-center-workflow，Git 工作区干净。
- 创建成功的完整开发前快照：2026-10-19_06-29-00-948_exception-center-acceptance-fix。数据库约 0.91 GB / 363528 条视频 / quick_check=ok。
- Git checkpoint-20261019-142856-42ee088-exception-center-acceptance-fix 已推送。按既有保留规则校验新快照并清理旧快照成功。
- 新分支 ai/exception-center-acceptance-fix，独立任务，单写入者。

## Changes

- 修复来源级列表有 3 个来源、顶部来源问题指标却显示 0 的矛盾。最近可访问性汇总和来源扫描错误缺少可精确并集的 IDs，现以两个统计的最大值作为“至少”需要检查的来源数，不伪称精确去重。
- 将总览“需要处理的问题”（扫描记录数）改为“需要核查的记录”；提示多条记录可能来自同一原因。
- 将“资料库来源不可访问”改为“资料库来源需要检查”，不因普通扫描错误就认定网盘已离线。
- 将批量合并的英文 unresolved scan issue(s) 摘要改成中文提示，原始技术信息保留在 title 中供诊断。
- 新增 HealthOverviewPage.test.tsx 的来源汇总边界测试，更新 CHANGELOG.md、docs/USER_GUIDE.md。
- 未变动扫描、元数据、文件删除、永久清理及服务端再次验证逻辑。

## Verification

- 基线性能及功能测试：6 个测试文件 / 101 项通过。
- 原版隔离 Windows GUI：独立用户数据目录中的 Electron 真正运行，用 CDP 执行异常中心总览、扫描失败、历史入口，均能导航；未操作真实视频。
- 隔离临时 SQLite 测试库 120000 条模拟扫描异常、3 来源、300 视频、2 历史记录；数据库分页查询实测：首页 461 ms、第 100 页 437 ms、第 4000 页 734 ms、目录筛选 434 ms（仅当前设备单次样本）。
- 旧版大数据 GUI 暴露两项问题：来源列表 3 个但顶部可访问性问题 0；120000 条记录被叫作 120000 个独立问题。确认并针对性修正。
- 旧版扫描列表显示历史中断标记和成功/失败摘要；自动化已有批量处理确认、取消、历史、数据库迁移覆盖。
- 改动后 npm run typecheck：通过；相关 UI 测试 70/70 通过。
- 修订后 `npm run lint`：PASS；`npm run test:node`：143 文件 / 1323 项全部 PASS；`npm run build`：PASS；`npm run test:electron-smoke`：PASS，包括 Electron 44.7.0 原生 ABI、SQLite/DPAPI 与 sandbox preload。
- 基于本轮构建的隔离临时验收包，Chrome DevTools Protocol 操作真实 Electron 页面：12 万条待核查记录、来源统计“至少 3”、记录错误 3、来源合并错误摘要改为中文、扫描页 119701 条记录，来源页面加载约 404 ms、扫描明细约 425 ms（预热后单次样本）；处理历史展示“意外中断”及失败摘要正常。
- 模拟选中跨页筛选结果后，点击“分析元数据”正确出现批量确认窗口（含处理范围、安全说明），随后点击“取消操作”关闭；**未确认提交，没有执行扫描任务、删除或清理**。实际 GUI 验收脚本输出 `.tmp/exception-acceptance-cdp-result.json`：PASSED=true，实际截图保存于忽略的 `.tmp` 下。
- 真正发布到本机用户每日桌面的包及 GitHub 推送在提交后执行；上述 UI 验收为同源代码的独立 *staging* 包（不作为公开发布）。

## Risks and follow-up

- 来源层面的多指标缺少精确合并 ID，界面使用“至少”保守值，不能宣称精准根因数。
- 独立测试库启动后可能自动扫描其虚构临时来源并改变仅测试数据；用户真实库未触及。
- 永久删除及真实 CloudDrive 端到端未在真实文件上执行；本轮不触发任何破坏性操作。
- 新版未完成重新打包前，不应声称用户桌面程序已更新。
- 本任务只发布日常开发身份，不发布公众 GitHub Release。

## Collaboration/Handoff history

- Owner: ChatGPT
- Branch: ai/exception-center-acceptance-fix
- Status: in_progress
- Next: 全量门禁、重新打包、isolated GUI / 大数据量验证、真实桌面快捷方式校验、推送并记录提交与风险。
