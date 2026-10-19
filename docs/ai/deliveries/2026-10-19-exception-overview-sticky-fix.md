# 异常中心总览标题遮挡修复

## Context

用户真实桌面截图显示异常中心总览标题被分类标签遮挡。基线 42b79b6，家用电脑 MP2T8QB5，开发分支 ai/exception-overview-sticky-fix。开工前完整快照 2026-10-19_07-04-50-685_exception-center-overview-sticky-header 已成功，checkpoint-20261019-150446-42b79b6-exception-center-overview-sticky-header 已推送；SQLite quick_check ok。按保留规则验证并清理旧备份完成。

## Changes

- LibraryShell 为没有通用 Toolbar 的异常中心总览添加专属标签栏类名，其他异常子页不变。
- CSS 为该类设置 top: var(--global-menu-height)，避免默认的额外 88px sticky 偏移覆盖总览标题。
- 在 LibraryShell.test.tsx 增加总览、切换文件缺失、返回总览时 CSS 类名变化断言。
- 更新 CHANGELOG.md 和 docs/USER_GUIDE.md。没有触及数据库、扫描、删除、远端操作逻辑。

## Verification

- 前轮单文件测试：68/68 PASS；npm run typecheck PASS。
- `npm run lint`：PASS，TypeScript 检查通过。
- `npm run test:node`：PASS，143 个测试文件 / 1323 项测试通过。
- `npm run build`：PASS（仅有已有的 >500 kB chunk 体积建议）。
- `npm run test:electron-smoke`：PASS，包括 Electron 44.7.0 原生 ABI、SQLite/DPAPI、sandboxed preload。
- 独立临时资料库中的真实 Windows Electron GUI + CDP 验收：PASS，12 万条模拟异常，总览标签栏 top=42 px、bottom=90 px，标题 top=141.5 px，无遮挡；滚动 320 px 后标签栏依然紧贴全局菜单；扫描失败页面标签栏 top=130 px，仍有公共工具栏；跨页批量确认窗口显示正确并取消，没有提交任务、删除真实文件。
- 使用修复代码生成 staging desktop 包并完成独立 GUI 验收；正式桌面快捷方式版本在 Git 提交后重新打包校验。

## Risks and follow-up

- 必须核实有公共 Toolbar 的扫描失败、文件缺失、元数据任务仍按原位粘顶，滚动时没有重叠。
- 真实视频资料库严禁测试性删除。只在独立临时数据目录做 GUI 验收。

## Documentation and release impact

- 更新未发布日志和用户教程。仅更新日常开发版，不发布公众 GitHub Release。

## Collaboration/Handoff history

- Owner: ChatGPT；状态 ready_to_deliver；分支 ai/exception-overview-sticky-fix；基线 42b79b6；2026-10-19 本轮已完成全量检查与隔离 GUI 验收，下一步完成 GitHub 普通推送及日常桌面开发包校验。
