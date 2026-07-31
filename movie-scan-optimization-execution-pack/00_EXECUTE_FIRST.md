# 映匣扫描机制优化｜直接执行说明

你正在操作本地项目。请直接在当前工作区完成实现，不访问远程仓库，不重新拉取代码，不新建项目，不覆盖未提交修改，也不要只输出方案。

## 先做

1. 阅读 `01_TASK_SPEC.md`。
2. 运行：

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\preflight.ps1
```

3. 在当前代码上直接完成修改、迁移、测试和文档。
4. 完成后运行：

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

5. 对照 `02_ACCEPTANCE_CHECKLIST.md` 验收。
6. 按 `03_FINAL_REPORT_TEMPLATE.md` 输出真实实施报告。

## 禁止

- `git reset --hard`
- `git clean -fd`
- `git restore .`
- `git checkout -- .`
- 删除现有数据库或要求用户重建资料库
- 覆盖本地未提交修改
- 只改前端文案而不改后台行为
- 留下 TODO、占位接口、空实现

发生代码冲突时，保留本地现有修改并做最小合并。无需向用户重复需求，不要在完成实现前停下来等待确认。
