# 测试模块

`tests/main` 覆盖 SQLite 仓储、扫描/发现/元数据、缓存、协议 URL/handler、文件操作、设置、IPC 契约、mpv/播放路由和启动同步；`tests/renderer` 用 Testing Library 覆盖资料库、播放器、设置；`tests/smoke` 验证脚手架配置；`setup.ts` 加载 jest-dom。

运行 `npm test`；构建契约另用 `npm run build`。发布前统一运行 `npm run test:release-gate`，其中 `test:windows-files` 使用合成临时资料库覆盖内容相同/不同、同名冲突、网络盘故障分支和真实微型 MP4/FFprobe，`test:migrations` 覆盖历史 schema/WAL/锁，`test:release-performance` 覆盖分页、重复候选、缓存和 300 项播放器队列。

测试大量使用临时目录、内存/临时数据库和依赖注入 mock，擅长验证确定性逻辑，但不能证明真实跨物理卷、NTFS ACL、外部程序独占锁、磁盘满、SMB 断线、GPU、签名和跨版本安装。相关验证必须填写 `docs/windows-release-checklist.md`，不要用单测通过替代桌面验收。

改仓储/IPC/文件/媒体时优先扩展同名测试；修 Bug 先写能复现边界的回归用例；改 shared 契约同时更新 contract test 与 renderer fixtures。
