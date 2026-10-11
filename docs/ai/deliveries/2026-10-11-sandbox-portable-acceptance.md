---
date: 2026-10-11
branch: ai/sandbox-portable-qa
type: docs
status: partial
---

# Windows 沙盒绿色包实际验收

## Context

用户安装 Windows 沙盒后，明确确认现有沙盒没有需要保留的内容，允许重启进行测试。本轮在本机沙盒中验证上一轮最终绿色包，不修改应用代码、不重新设计架构。已完成下面列出的沙盒验收；正式发行条件仍未齐备。

开发前快照：`2026-10-11_04-54-15-904_sandbox-portable-qa`；远程 checkpoint：`checkpoint-20261011-125410-19465ef-sandbox-portable-qa`。真实资料库 345892 条视频，SQLite quick_check 正常。按授权执行备份维护，核验最近三份开发快照和三份数据库升级备份后删除一份旧快照；真实资料库及源视频未参与沙盒测试。

## Changes

- 保存脱敏、可核对哈希的 [沙盒验收证据](../../QA/2026-10-11-sandbox-portable-evidence.json)，补充稳定版验收方案和 Release 草稿的实际进度。
- 本机没有新版 `wsb` CLI，使用 [微软文档中的 .wsb 配置](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)：只读映射测试输入、单独映射可写结果目录，LogonCommand 自动校验、解压和启动。其余沙盒设置保持默认。
- 只映射完整绿色 ZIP、合成测试视频和测试脚本，不映射仓库、真实资料库、个人视频或凭据。脚本及原始结果保存在忽略目录 `.tmp/sandbox-portable-20261011/`，不提交数据库、媒体、运行日志或二进制。
- 未修改发行审批，也未重新打包：本轮交付是测试证据，原绿色包对应的代码仍为 `19465ef7500fb53c325a5079126497e1fe34cd57`。

## Verification

日期均为北京时间 2026-10-11。沙盒界面显示 **Windows 11 Enterprise Insider Preview**，build **26100.9606**，AMD64；注册表 ProductName 仍显示 Windows 10 Enterprise，不能据此把本轮写成稳定版验收。默认账户为 WDAGUtilityAccount，不作为普通非管理员账户测试证据。

测试文件：`release/unsigned-test-build/拉面影视-0.1.15-x64-unsigned-test-build-Portable.zip`。

SHA-256：`e52289cc4a50380d335c71601883ec78d556f726a228e08f38ad17c04a509228`。

| 场景 | 实际结果 |
| --- | --- |
| 干净环境 | 启动前 node/npm/ffmpeg/ffprobe/git/python 外部命令均不存在；测试身份资料库不存在 |
| 绿色包完整性 | ZIP 哈希一致，189 个解压文件逐一 SHA-256 验证通过 |
| 无额外运行库 | 未安装外部 Node.js/FFmpeg；打包程序 create/verify smoke 均 PASS，包括 SQLite、FFmpeg 执行、renderer/preload、预览和安全断言 |
| 首次启动、扫描 | 实际 GUI 启动，添加目录后索引 3 条视频；三条元数据和缩略图均 ready |
| H.264 MP4 | Chromium 播放有活动彩色画面；暂停、跳转、恢复 PASS；用户对当时测试音回答“能听到” |
| H.265 MP4 | 内嵌解码有活动彩色画面；暂停及快进 10 秒 PASS；未单独确认声音 |
| H.264 MKV | 内嵌解码有活动彩色画面；暂停、快进 10 秒及恢复 PASS；未单独确认声音 |
| 换目录重启 | 正常关闭，程序从 `C:\MovieQA\Program` 移到 `Program-updated` 后实际重启；仍有 3 条视频、1 个收藏、3 条历史 |
| 数据保存 | 首次退出、换目录重启退出、移除程序后三份 SQLite 均 quick_check=ok，schema=15；相同视频 ID、收藏、历史位置完全保留 |
| 移除绿色程序 | 程序及 NativeHost 正常退出后仅删除沙盒内程序目录；AppData 资料库保留，删除前后数据库文件 SHA 相同，三个源视频 SHA 均不变 |

播放历史保存位置分别为 H.264 `25080ms`、H.265 `24041ms`、MKV `34792ms`。合成样片每份约 35 秒、320×180、AAC 测试音，不代表所有编码和真实媒体均已验收。原始收据和数据库副本留在本地忽略目录；提交的证据只保留检查结果和哈希。

首次沙盒准备尝试在程序启动前失败：测试脚本先创建 SyntheticMedia，又复制同名目录，发生目录冲突。保留失败收据，修正测试脚本后重启空沙盒，第二次准备及上述验收成功。这是测试准备问题，没有据此修改应用或宣称修复产品缺陷。

本轮在同一工作区重新运行的仓库质量检查：

- `npm run lint`、`npm run typecheck`：PASS，包含 TypeScript noEmit 检查；`npm run build`：PASS。
- `npm test`：PASS，134 个测试文件、1204 项测试。
- `npm run test:electron-smoke`：PASS，原生 SQLite、三种发行身份/DPAPI/换目录重开、主进程和 preload 均通过。
- `npm run test:renderer-security-smoke`：PASS。
- `npm run test:media-candidate-contract`：PASS，60/60。
- 三份沙盒 SQLite 副本独立校验、九次源视频哈希核对、移除程序前后数据库文件哈希比较：PASS。
- `git diff --check`：PASS。独立 E2E npm 脚本不存在；交互验收使用真实沙盒 GUI 和打包产物 smoke。

## Risks and follow-up

- 此次绿色测试包未复现播放黑屏，H.264 人工试听通过。H.265/MKV 经原生播放器输出的声音仍需人工确认；不能把 H.264 试听推广到两种原生播放样片。
- 稳定 Windows 11、普通用户权限、真实高分辨率/HDR/更多编码、NAS、公众版身份和下载后 SmartScreen 行为仍未在本轮验证。绿色目录移除不等于安装器卸载或历史签名版升级验收。
- libmpv 完整静态依赖源码、通知和宿主组合发行条件，以及 FFmpeg Lite 最终源码公开/适用重链接材料仍未放行。
- `ownersConfirmed=true`、`approved=false`、`manualQaApproved=false`；各二进制 sourceComplianceApproved 均 false。没有发布 GitHub Release、上传公开程序或推版本发布标签。
- 本轮只更新验收文档。此前已验证的本机绿色测试快捷方式仍指向 `release/unsigned-test-build/portable-qa-nLMQRi/拉面影视-unsigned-test-build.exe`，对应上述代码提交；原日常桌面程序保持原状，正式桌面版本尚未交付。
- 自动交付在本轮完整等价检查通过并记录后使用 `-SkipChecks`，正常推送功能分支和 main，先保留远程 main 备份标签。
