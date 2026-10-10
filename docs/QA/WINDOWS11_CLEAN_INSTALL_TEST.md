# Windows 11 稳定版干净安装与实际播放验收

**当前状态：NOT RUN（2026-10-10）。** 家用 B5 是安装开发工具的 Insider build 26220，不是稳定版、无开发环境的验收机器。本文是执行方案与证据模板，不能作为测试已通过的证明。

## 机器与安全边界

- 新建可销毁的 Windows 11 稳定版 x64 虚拟机，创建原始快照；不安装 Node/npm/Git，尽量使用普通 Windows 用户。不能在办公电脑 707 上操作，也不能拿 B5 真实操作系统、真实视频或 SQLite 做破坏性测试。
- 仅复制已经核验的 **unsigned-test-build 隔离 QA 身份**文件，不覆盖正式签名版。家用 B5 上 QA 套件位于 `D:\CodexReleaseAudit\movie-clean-win11-QA-v0.1.15-b2700e2\`；它不是可公开下载的安装器。
- 安装器 SHA-256 必须为 `d97eb9848adab07d5a938852df612e20312ba431bbda51a14a525de1ab2e70cd`。任何安装器变更都必须重跑验收。
- 测试用文件为合成小视频、空目录、中文路径、受限目录等。不要使用个人珍藏/NAS 真实媒体测试永久删除。

## 基础环境核对

在新的 VM PowerShell 执行下列命令，保存输出和屏幕截图：

```powershell
(Get-CimInstance Win32_OperatingSystem) | Select-Object Caption,Version,BuildNumber
[Environment]::Is64BitOperatingSystem
Get-Command node.exe,npm.cmd,git.exe -ErrorAction SilentlyContinue
Get-FileHash -Algorithm SHA256 -LiteralPath '.\拉面影视-0.1.15-x64-unsigned-test-build-Setup.exe'
```

系统必须是稳定 Windows 11 x64；第三行不应找到开发工具；最后的哈希应严格匹配上面的固定值。还需记录 VM 软件版本、快照、磁盘余量、网络状态及当前权限。

## 自动安装、修复、卸载与数据保留测试

将完整 QA 套件复制到 VM，并在其目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\clean-windows11-acceptance.ps1 -ArtifactDirectory . -DisposableMachineAcknowledged
```

此脚本无需 Node；会核对 Windows、身份、SHA、签名状态，使用隔离临时目录执行真实安装、packaged create/verify、合成视频、同包修复、卸载及 SQLite/视频文件 SHA 哨兵保护。成功后会生成 `clean-windows11-evidence.json`，其中 `manualUi` 和 `historicalSignedUpgrade` 仍应为 `NOT_RUN`。

若失败，保留 VM 快照、命令输出、临时目录与错误文件；区分安装失败、程序失败和环境失败。严禁删真实视频或移除安全断言以获取 PASS。必要时销毁 VM 并从原始快照重试。

## 独立人工可视验收

| 场景 | 应验证 | 目前 |
| --- | --- | --- |
| 首次启动 | 主窗口渲染、无白屏、快捷方式及安装身份正确 | NOT RUN |
| 资料库来源 | 合成目录、子目录、中文路径、空目录、无权限目录 | NOT RUN |
| 元数据及扫描 | 数量正确、失败可解释、无需再次手工修数据 | NOT RUN |
| 封面 / 进度预览 | 受支持格式正常，失败时可恢复 | NOT RUN |
| 检索/收藏/历史 | 正常写入并在应用重启后保留 | NOT RUN |
| 真实播放 | 有画面和声音；暂停、跳转、进度、结束可工作 | NOT RUN |
| 多种扩展名 | MP4/MKV/MOV/AVI 逐个验证，记录不支持格式，不虚报兼容 | NOT RUN |
| 网络来源 | 在专门的临时 SMB 测试共享验证权限、断连和恢复 | NOT RUN |
| 关闭与重启 | SQLite、配置、已索引合成视频无损 | NOT RUN |
| 卸载 | 程序清除，但合成媒体及用户数据哨兵保持相同 SHA | NOT RUN |
| 故障模拟 | 磁盘不足、权限拒绝、源目录离线时不乱删文件 | NOT RUN |
| 公众版身份 | 将来真正独立社区身份安装器生成后单独复测 | NOT RUN |

不要把只通过脚本的后台 smoke 误判成界面及播放合格。未生成公众版安装器前，禁止把测试身份的截图当成正式社区版证据。

## 实际验收证据填写模板

```text
OS / full build:
VM implementation / version / original snapshot:
No Node/npm/Git command result:
Tester and date:
Git commit:
Flavor / appId:
Installer filename / bytes / SHA256:
Automated result JSON path / SHA256:
First-launch / indexing / preview / playback / restart:
Repair + uninstall + SQLite/media preservation:
Failure tests and any known unsupported video types:
Redacted screenshots and logs:
Reviewer and disposition:
```

仅使用脱敏截图，不收集真实用户资料或令牌。真实证据完成后由有权维护者核对、保存审查记录与文件哈希，再考虑更新审批。当前 `build/release-approval.json.approved=false` 不得更改。

现有补充说明：[原始验收脚本使用说明](../clean-windows11-acceptance.md) · [发布门禁](../RELEASE_CHECKLIST.md)。
