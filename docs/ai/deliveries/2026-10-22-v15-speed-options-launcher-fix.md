# v1.5 3×/4×/5× 未显示：启动入口不一致修复

- 日期：2026-10-22。操作范围仅家里电脑 `MP2T8QB5`，Git 分支 `ai/player-speed-3x-5x`。
- 用户截图中倍速仅至 2×；读取进程确认其主窗口及播放器窗口均来自旧版 `release/win-unpacked/拉面影视.exe`（v1.3），不是 v1.5。
- v1.5 部署的 `resources/app.asar` 前端 JS 已直接读取核实含 `No=[.5,.75,1,1.25,1.5,1.75,2,3,4,5]`，故不需重新编译源码或再次提高版本号。
- 发现 Windows **开始菜单** `%APPDATA%/Microsoft/Windows/Start Menu/Programs/拉面影视.lnk` 仍指向旧 `release/win-unpacked`；桌面 `拉面影视.lnk` 已指向 v1.5。两个入口的 TargetPath/WorkingDirectory 已统一指向 `release/daily-v1.5/win-unpacked/拉面影视.exe`。分别备份旧链接到 `.tmp/daily-v15-shortcuts-unify/`。
- 统一之后检查旧进程已自然退出（执行关进程时旧版进程数为 0），从正确入口重新启动 v1.5，确认 **4 个进程全部来自 v1.5 目录，其他拉面影视进程 0 个**。
- 本次只修正 Windows 启动入口、更新交接规则，不修改视频库、不执行文件删除、不更新技术包或界面号、不推送 GitHub。
- 验证边界：已确认正式日常包中的前端资源包含新增倍速项，并确认运行路径为 v1.5；尚未通过真实视频播放窗口手动展开菜单截图验收，需用户正常打开播放器检视。
- 本地开发前安全备份：`2026-10-21_17-52-09-626_unify-daily-launchers`，SQLite quick_check=ok，363039 条视频。
- 原有 5 项与此无关的未提交工作区文件继续保留，不混入提交；旧 v1.3 程序仍留在磁盘上以便回滚。
