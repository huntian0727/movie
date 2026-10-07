---
date: 2026-10-07
branch: ai/sidebar-directory-search
type: feat
status: completed
---

# 左侧目录搜索

## Context

用户确认目录搜索设计：固定左侧搜索框、范围切换、名称优先结果、来源与父路径、点击目录后导航、保留原折叠与排序。基于本地已提交 `a9f96c8`（包含最新图片目录与安全修复），工作区干净。开发前快照 `2026-10-07_14-22-28-634_sidebar-directory-search`，checkpoint `checkpoint-20261007-222223-a9f96c8-sidebar-directory-search` 已推送；数据库 0.87GB / 345892 记录，quick_check OK。

## Changes

- 新增 SidebarDirectorySearch；200ms 防抖、独立 purpose、过期请求隔离、全部/当前来源范围、来源与父路径、名称/路径高亮、键盘操作、加载/空结果/错误重试状态。
- 搜索结果替换左侧树显示；原树保持挂载，展开/缓存/手动同级排序保留。输入不改变右侧，选择结果沿用 exact 目录导航并同步祖先，清空后滚动定位当前节点。折叠保留查询，重启清空。
- 数据库搜索补齐注册根和视频支持的父目录，名称完全/前缀/包含匹配优先。来源+规范路径去重，UNC/驱动器根/字面通配符边界；流式处理聚合行，只保留有限排名候选，截断前排序。
- 完整路径的精确匹配与名称精确匹配一同优先，避免输入父级完整路径后被大量子目录截断。
- 发布门禁发现原有来源统计在本机持续略超 2s：完整批次 2087.55ms，单独复测 2054.16ms。EXPLAIN 确认 video_stats 使用来源索引逐条取表记录；全表来源统计改用 `NOT INDEXED` 顺序读取后聚合，SQL 输出及一次查询契约不变，不调整测试门槛。
- 不改数据库 schema、视频分页、扫描、媒体操作、删除、安全凭据或实际图片目录读取。搜索仅查询缓存数据库；注册来源根以外的空/未入库目录不保证可搜索。

## Verification

- Node 22.23.1 / npm 10.9.8；typecheck PASS。
- 定向 5 文件 / 93 项 PASS：renderer 防抖/竞态/键盘/范围/重试/折叠/右侧导航/原树排序保留；repository 父目录/根/同名/排名截断/字面通配符/Unicode/UNC/根盘边界；Worker 查询隔离。
- 完整 release gate 覆盖 lint/typecheck、build、Windows 文件、迁移、发布性能及 123 文件 / 1062 项：1061 PASS，原资产中心性能门槛 1 项失败（日志 `.tmp/directory-search-release-gate.log`）。失败项修复及最终受影响检查随后重新执行；未绕过失败或放宽门槛。
- 修复后受影响 4 文件 / 18 项 PASS：repository、Worker、32 万条/100 来源性能和主循环性能。来源统计 435.34ms / 1 SQL（原门槛 2000ms），目录搜索 1461.60ms / 2 SQL（门槛 3000ms），异常查询 845.52ms / 2 SQL。目录结果截断前排序且最多返回 100 条；完整路径精确命中不会被子目录挤出上限。
- 本轮完整门禁的通过部分、失败项修复及所有受影响项原样复测共同覆盖最终代码；未放宽阈值。最终 typecheck PASS。自动交付使用 `-SkipChecks`，避免重复整个批次和交叉切换 Node/Electron SQLite ABI。
- 最终 build PASS；prepare:electron PASS（Electron 33.4.11 / SQLite ABI 130）；test:electron-smoke PASS，含主/播放器 sandbox preload 和 OS-backed safeStorage 原有安全回归。
- 提交后重新构建桌面包并执行 Electron/packaged smoke、制品检查与真实快捷方式验收。最终桌面证据 `.tmp/directory-search-desktop-proof.json`；必须成功后才能报告桌面交付。
- 独立 E2E 脚本不适用（package.json 未定义）；安装/卸载 smoke 不涉及本轮代码，未运行。

## Risks and follow-up

- LIKE 在数据库支持的大小写规则下匹配，名称排序/去重在 Worker 中完成；频繁短关键词仍需执行数据库聚合，由防抖、有限候选和后台 Worker 限制 UI 影响。
- 同名目录按所属资料库和父路径区分；搜索结果顺序不改写原手动目录顺序。搜索词和范围为临时会话状态。
- 本轮不进行真实媒体扫描、移动、删除、播放或批量解析。搜索前后只读数据库并保留原目录访问语义。
