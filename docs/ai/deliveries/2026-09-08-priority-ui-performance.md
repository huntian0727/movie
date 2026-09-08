# 优先界面与性能优化

## Context

落实项目审查的三个优先建议：目录排行可见、分析状态清晰、重复项查询后台化。

## Changes

- 分支：ai/priority-ui-performance
- 将重复项目录排行直接展示为可搜索、分页表格，沿用数量/空间排序筛选，点击即可优先保留并查看目录候选。
- 视频卡片和表格的 pending 状态统一为“待分析”；详情明确可能尚未入队，运行计数仍以元数据明细为准。
- 重复项分页查询移到只读 Worker，数据库 data_version 变化时重建查询缓存，清理写操作保持原有执行路径。
- 修正选择模式下键盘激活封面仍打开视频的问题。
## Verification

- 验证：Node 22.23.1 test:release-gate 通过（68 文件、644 项测试）；dist:win、Electron smoke、包内容检查、解压版和安装器 smoke 全部通过。
- 打包冒烟实际导航到重复项页面，directoryRankingVisible=true；真实只读后台重复项查询与原查询结果一致，duplicateWorkerQuery=true。
- 桌面快捷方式 Video Manager (Dev).lnk 指向 movie/.tmp/priority-ui-delivery/release/win-unpacked/Local Video Manager.exe，已从快捷方式启动并确认实际进程路径。未完成人工像素级复核。
- 原工作区出现并行视频数据表开发及分支切换，因此使用独立工作树交付本次改动，保留原工作区全部内容；隔离工作树作为当前桌面包位置保留。
## Risks and follow-up

- 限制：本轮先实施审查建议中的三个优先项。目录统计拆分传输、全局查询合并与大组虚拟化留待后续；当前目录排行数值仍是候选估算。
