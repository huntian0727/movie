# 公开测试版范围与授权（2026-10-22，北京时间）

本次发布按维护者“尽快发布、简化非必要门禁”的明确要求，沿用此前选择的公开测试版路线，目标版本为 0.1.16-beta.1（界面版本 v1.6）。本次只发布未签名的 Windows x64 绿色 ZIP、对应应用源码、对应原生运行库源码/许可材料与 SHA-256 清单；GitHub Release 必须标记为 Prerelease，不标记为 Latest。此决定不批准稳定版 0.1.16、NSIS 安装器、数字签名或签名升级。

本版复用此前已核准的 FFmpeg/FFprobe 与共享 libmpv 运行库归档，锁文件、归档哈希、第三方运行库 PE 哈希及对应第三方源码归档保持不变。唯一变更的原生 PE 是项目自有 MIT 代码 NativeHost：为播放器倍速增加 speed 属性读写。当前源码与确定性 Windows 构建已核对；GitHub Windows CI #251 和本机构建产生相同 SHA-256。应用源码归档包含该版 NativeHost.cs、构建脚本、许可和批准材料。

## 已验证范围

- PR #29 对应代码提交的 Windows CI #251 与安全审查 #85 均通过；CI 覆盖 Node/Windows 文件安全、Electron/主进程 smoke、依赖审查、未签名安装包及隔离安装/修复/卸载 smoke。
- 当前 beta 绿色 ZIP 已通过 230 个文件的逐项解压比对及实际打包程序 smoke；SHA-256 将以最终 Release 附件清单为准。
- 保留项目 MIT 许可、第三方版权/许可、LGPL/GPL 适用文本、对应原生源码和构建材料。应用自身 MIT 不替代第三方库的独立许可义务。

## 已知限制（不冒充已验收）

人工验收历史环境是 Windows 11 Enterprise Insider Preview 26100.9606 的 Windows Sandbox 默认账号。稳定版 Windows 11、标准用户权限、NSIS 安装/卸载、SmartScreen 首次下载、签名升级、4K/HDR、长期负载均未认证。本次没有在真实 CloudDrive/115 资料库执行破坏性删除回归。请先备份资料库和重要视频，再测试后台清理；不要把本预发布版当作唯一数据副本或已认证的稳定版。

原有 docs/QA/2026-10-12-source-community-sandbox-evidence.json 保持原样，不追溯改写测试当时的结论。稳定发行批准仍为 false；本决定仅限公开预发布绿色 ZIP，不得用作稳定版/安装器授权。
