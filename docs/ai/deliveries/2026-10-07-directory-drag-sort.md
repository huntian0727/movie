---
date: 2026-10-07
branch: ai/directory-drag-sort
type: feat
status: completed
---

# 资料库目录拖拽排序

## Context

用户希望在左侧资料库目录中拖拽调整顺序。开发前工作区干净，基准 `e6d051f`；快照 `2026-10-07_06-42-51-408_directory-drag-sort`，checkpoint `checkpoint-20261007-144245-e6d051f-directory-drag-sort` 已推送。SQLite 0.87 GB、345479 条记录，quick_check 正常。

## Changes

- `DirectoryFilterTree` 的根来源、同父子目录增加 Pointer Events 拖拽手柄；目标上半部插入前、下半部插入后，显示落点线。4px 启动阈值避免误触，指针捕获保留拖动，边缘移动滚动目录列表；Esc、指针取消或捕获丢失可取消。拖拽不调用目录导航，不修改选中路径或展开状态。
- 支持聚焦手柄后 Alt + 上/下调整顺序，提供恢复全部默认排序入口。
- `directoryTreeOrder` 以根来源 ID、来源 ID + 规范化父/子路径保存展示顺序到当前 Electron profile 的 localStorage。刷新/重启保留，新增目录置后，不丢弃已保存但当前不在前 100 项中的身份。
- 拒绝跨父目录、跨来源、外部文件拖入；排序不写磁盘或数据库，不更改右侧目录卡片、视频排序/分页、扫描、播放队列。
- 存储数据异常时采用默认顺序；写入失败仍保留会话内调整并提示可能无法在重启后保留。

## Verification

- 固定 Node 22.23.1/npm 10.9.8；Node SQLite binding 已恢复 ABI 127。
- 最终 `typecheck` PASS；定向 `DirectoryFilterTree` + `App` 2 文件 / 16 项 PASS，覆盖双向插入、重挂载恢复、重置、同级隔离、新发现目录置后、拒绝外部文件、键盘排序、存储失败、4px 阈值、Esc 与指针取消，以及原有移除进度提示。
- 第一轮完整门禁 998 PASS / 1 FAIL：新增的空 status 区域与 App 的移除进度测试冲突，已改为有消息时才渲染，定向回归通过。
- 最终 `test:release-gate` PASS：115 文件 / 1000 项，包含 lint/typecheck、build、Windows 文件、迁移和性能门禁；全量用时 205.03s。日志 `.tmp/directory-release-gate.log`，1–2 workers。
- 第一轮打包过早与 Node 测试重叠，native rebuild 因 EPERM 文件占用失败；等测试进程退出后重建成功，未删除用户数据库或媒体。
- `package:dir`、Electron native/main-process smoke PASS。真实鼠标试验发现浏览器原生拖拽未完成排序，改为指针捕获处理后重新打包并通过鼠标验证。预验收 app.asar SHA-256 `336EBDE79BE229772FC014BADEFED9E374A8AD30C91572BDF691C940D77B8116`。
- 桌面快捷方式已实际启动，指向 `%USERPROFILE%/Documents/视频管理/movie/release/win-unpacked/拉面影视.exe`。真实 UI：根来源拖动换位、子目录拖动换位成功，资产中心保持不变；根来源/子目录顺序均经关闭应用并重启验证；恢复默认排序成功，已清除验收产生的调整。
- 提交后将重新生成 NSIS/unpacked，验证制品/packaged smoke、Commit/asar 时间及最终快捷方式实启，结果保存在 `.tmp/directory-drag-desktop-proof.json`；失败必须在最终报告说明，不能把此预期当成成功。
- 独立 E2E 脚本：不适用（package.json 未声明）；已执行真实桌面鼠标、键盘及重启交互验证。安装/卸载 smoke 未运行（本轮未改变安装器）。

## Risks and follow-up

- 自定义顺序属于当前本机 Electron profile 的展示偏好；不跨设备同步，不跟随磁盘文件夹重命名。
- 沿用单级最多 100 项的目录索引显示范围，不加载全库目录。右侧文件夹卡片保留原索引排序。
- 本轮没有操作用户媒体的扫描、删除、移动或播放。
