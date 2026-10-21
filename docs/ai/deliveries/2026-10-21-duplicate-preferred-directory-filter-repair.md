---
date: 2026-10-21
branch: ai/duplicate-preferred-directory-filter-repair
status: local-development
---

# “优先保留此目录”筛选未生效修复

## 问题与根因

用户在重复文件页点击“优先保留此目录”后，期待马上只看到该目录树所涉及的重复组。现有 UI 在保存目录成功前才更新筛选；更严重的是持久化的首选目录在再次进入重复页时只恢复“优先保留”规则，不恢复“目录筛选”条件，所以看起来已选中目录却仍展示全库重复组。此前单测仅覆盖无持久化 API 的分支，因此漏掉了这一实际桌面安装版路径。

## 只读真实数据核对

家里 PC MP2T8QB5，正式日常开发数据目录（用户已迁移至 D 盘）。使用只读 better-sqlite3 连接，不写入、不操作媒体文件：
- 全部资料库视频：363528 条。
- 当前保存的优先保留目录（未导出具体路径）：该目录直接匹配 4 条视频。
- 真实仓库 `VideoRepository.listDuplicateGroupsPage` 查询：带 `preferredDirectoryPaths` 和 `filterDirectoryPath` 后 **3 个重复候选组**，全部匹配组 **11141 个**，约 2.8 秒；证明后端原有目录树查询本身有效，不应重写 SQL。
- 过滤按“该目录树至少有 1 个文件的重复组”计算。为核对和选择保留项，组内其它目录的对应副本仍显示；无关组应隐藏。

## 开发改动

- `src/renderer/components/LibraryShell.tsx`：
  1. 初次进入重复页时先加载保存的优先保留目录，再发查询，避免首次按全库 11141 组加载引发误解或延迟。
  2. 保存的保留目录恢复时同步恢复 `duplicateFilterDirectoryPath`，第一页重置。
  3. 点击组内“优先保留此目录”立即设置递归筛选，不等待异步目录保存完成；保存后使用后端返回的规范化目录路径；保存失败恢复此前范围并反馈错误。
  4. 立即点击时让新选择优先于旧保存的保留列表，避免短暂按旧目录规划。
  5. 显式点击“显示全部”会标记用户已选择范围，异步旧偏好读取不会再强行覆盖；删除偏好也清除范围。
  6. 每次带目录筛选的查询在展示前验证每个重复组至少有一个成员来自选定目录/子目录。若后端错误返回其它组则展示错误而非冒充筛选成功。
- `tests/renderer/LibraryShell.test.tsx`：补 3 个完整流程集成用例：保存偏好恢复筛选、异步保存尚未完成时点击立即筛选、后台不按目录筛选时拒绝错误展示。
- `CHANGELOG.md`、`docs/USER_GUIDE.md`、组件 README：追加操作说明及未发布记录。判重仍只用大小+整秒时长，不计算视频内容哈希。

## 验证

- `npm run typecheck`：PASS。
- `vitest run tests/renderer/LibraryShell.test.tsx tests/renderer/DuplicateGroupsPage.test.tsx tests/main/videoRepository.test.ts`：**172/172 PASS**，3 个测试文件。
- 本次没有执行删除真实媒体文件；没有修改用户 SQLite 数据。
- 日常本地打包与桌面快捷方式启动结果：等待本轮最终执行记录补充。
- 项目既有的 3 条发布审批/哈希证据门禁不属于本次目录筛选修复，不擅自变更审批。
- 严格遵守：只在家里设备；仅本地开发分支提交，不推送 GitHub 或公开发布。

## 回退保障

改动前通过 `scripts/project-backup.ps1 -Action Create -Label duplicate-preferred-directory-filter-repair -LocalOnly` 创建快照 `2026-10-21_01-08-26-053_duplicate-preferred-directory-filter-repair` 与本地 checkpoint `checkpoint-20261021-090824-c838a3d-duplicate-preferred-directory-filter-repair`，数据库 quick_check=ok。
