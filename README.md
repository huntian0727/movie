# 拉面影视

Windows x64 的本地视频资料库。使用 Electron、React 和 SQLite 管理索引、封面、收藏、播放记录和视频目录；视频保留在原位置。

**发布状态（2026-10-08，北京时间）：正式发布尚未放行。** 本轮只制作隔离的 `unsigned-test-build` 测试包。
项目自有代码许可证及第三方二进制分发授权仍待确认，根目录 [LICENSE](LICENSE) 不构成许可授予。
不要把测试包作为签名正式版本对外传播。详细风险和实测状态见 [发布审计](docs/public-release-audit.md)。

## 实际功能

- 添加本地来源目录，递归扫描视频和读取 FFprobe 元数据；网格/表格、搜索、收藏、播放历史、分页、缺失文件与异常复查。
- 支持嵌套来源和目录浏览、图片缩略图及大图浏览；移除来源只移除索引，不删除源视频。
- 可配置 CloudDrive2 API 扫描、挂载目录及远端重复候选清理；HTTP 仅允许严格回环地址，其他连接必须 HTTPS。
- 封面和时间轴预览采用可重建的独立缓存，默认上限 10 GiB；清理缓存不删除源视频。
- 独立播放窗口，Chromium 能播放的格式可直接播放；内嵌 mpv 需要单独配置可用的 libmpv，包内 NativeHost.exe 本身不是完整 mpv 播放器。
- 可选在线字幕搜索/下载与本地字幕；搜索可能向提供方发送文件名、关键词和语言等信息。
- 移动、重命名和永久删除；永久删除不进入 Windows 回收站，删除后不能依靠 SQLite 恢复视频。

重复候选来自缓存的大小、时长及 CloudDrive 身份，**不是内容相同的证明**。
当前快速重复清理仅支持有远端身份的 CloudDrive 文件，跳过完整 SHA-256 比对，按原有产品决策点击后提交删除。
主进程检查计划身份、当前缓存版本和连接绑定；取消阻止新的请求，已发出的远端删除无法撤回。
若服务只提供回收站操作，界面不会把它记为永久删除回收空间。完整 SHA-256 的旧后端流程仍存在，当前界面没有独立安全模式入口。
未确认相同内容时不要使用快速删除；公众默认行为仍待维护者决定。

## 安装与系统要求

目标系统：Windows 11 x64；当前实机是 Windows 11 Insider，干净稳定版 Windows 11 验收仍需完成。
普通用户运行安装包不需要安装 Node.js、npm 或开发工具。
签名正式安装包只应从维护者批准的 GitHub Release 获取；当前没有本轮正式发行。

测试包拥有独立 appId、安装名和 `%APPDATA%\local-video-manager-unsigned-test` 数据目录，不能当作现有正式版的升级包。
完整下载、SHA-256、签名核对、安装、迁移和卸载步骤见 [普通用户安装教程](docs/windows-installation.md)。
遇到 SmartScreen 或发布者不符应停止并核实来源；不要为了安装测试包关闭系统防护。

截图来自实际 unsigned-test-build，仅使用合成蓝色视频及临时资料库；旧交付记录里的真实资料库截图不作为公众素材。

![合成资料库浏览](docs/screenshots/public-release-library.jpg)

![永久删除确认，验收时选择取消](docs/screenshots/public-release-delete-warning.jpg)

## 隐私与数据位置

正式身份保持 appId `com.local.video.manager`、产品名“拉面影视”、版本 0.1.15；正式资料路径为
`%APPDATA%\local-video-manager`。库文件是 `library.sqlite`；设置、脱敏日志、字幕、封面/时间轴缓存也位于专属数据目录。
卸载保留应用数据和源视频。SQLite 备份不能替代原始视频备份。

CloudDrive Token 仅在主进程使用 Windows DPAPI 密文存储；Renderer 不读取 Token。
更换 Windows 用户/电脑后可能需要重新配置凭据。凭据损坏会停用该连接并提示重新输入，不静默切换到环境变量里的其他账户。
存在可重试清理任务时，必须先审查/清除其任务记录才能修改连接；旧未绑定任务需重新创建。

应用不上传整个资料库作为核心工作流程。CloudDrive 和字幕功能会按配置/用户操作连接外部服务，网络提供方有自己的隐私政策。
诊断包仅包含白名单环境信息和脱敏日志，但导出后仍应先审阅再分享。

## 开发和验证

工具链固定 Node.js 22.23.1 / npm 10.9.8。本轮升级到 Electron 44.7.0、better-sqlite3 13.0.3、Vite 8.3.3、Vitest 5.0.3。npm 10 的 N-API 安装缺陷及 `install:locked` 入口见 [原生模块工作流](docs/native-abi-workflow.md)。
Electron 官方只支持最新三个稳定主版本；版本升级须重跑原生 ABI、三窗口 IPC/CSP、媒体、迁移、删除、打包和安装测试。
参见 [官方支持政策](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)。

Node 测试 checkout：

~~~powershell
npm run install:locked
npm run test:release-gate
npm audit
~~~

独立 Electron 打包 checkout：

~~~powershell
npm run install:locked
npm run package:dir
npm run test:electron-smoke
npm run test:renderer-security-smoke
npm run verify:artifact
npm run test:packaged-smoke
npm run dist:win
npm run release:metadata
npm run test:installer-smoke
~~~

SQLite13 官方 N-API 文件已在 Node 与 Electron 中分别实测验证；旧版11 ABI文件不能复用，详见 [原生模块工作流](docs/native-abi-workflow.md)。
测试包输出在 `release/unsigned-test-build`，正式候选在 `release/signed-release`；已有用户便携包不会被测试打包覆盖。
正式构建同时需要受保护 GitHub environment、Secret 证书、实际 Authenticode 验证、许可证/二进制来源/人工 QA 哈希批准记录。
没有这些材料时门禁拒绝正式发行，参见 [发布工作流](docs/release-workflow.md)。

## 已知限制与维护

- npm audit不覆盖原生EXE。现有媒体二进制落后于官方后续安全修复，确切补丁适用性及替换方案未闭环，见 [二进制安全审查](docs/legal/native-binary-security.md)。
- FFmpeg 6.1.1 / FFprobe 4.0.2 实际构建启用 GPL；对应源码及启用库材料尚未闭环，不能仅凭 npm 包许可证批准分发。
- 无代码签名证书；干净无 Node 的 Windows 11、历史签名版升级、跨物理卷/SMB/ACL/磁盘满实机矩阵仍须验收。
- 旧 NSIS 卸载器可能递归删除安装目录，新包拒绝未经审查的旧版升级；不要把用户文件放入应用安装目录。
- libmpv 和系统默认播放器由用户另行安装；编解码兼容性取决于实际格式与播放器。
- 当前使用 Electron 默认图标，尚未核准独立品牌图标。

贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md)；私人安全报告：[SECURITY.md](SECURITY.md)；
授权材料：[第三方合规](docs/legal/RELEASE-COMPLIANCE.md)；历史文档：[公开卫生说明](docs/PUBLICATION-HYGIENE.md)。
历史设计和 AI 交付是溯源资料，不能替代当前代码与本轮实测结果。
