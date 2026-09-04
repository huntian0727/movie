# 映匣 UI V1 最终发布验证

## 验证结论

通过。资产中心、播放诊断中心及 UI 细节优化已经依次完成开发和独立 QA，最终打包产物也通过真实 ASAR、安装与覆盖安装验证。

## 分支与基线

- 最终发布分支：`ai/ui-v1-release`
- 发布前基线：`c740f238ae69ea4b651e19cab1888667189a0300`
- 应用版本：`0.1.15`
- 构建环境：Node.js 22.23.1、npm 10.9.8、Electron 33.4.11

## 自动化测试

- `npm run test:release-gate`：通过，64 个测试文件、619 个测试。
- Windows 专项：37/37 通过。
- 数据库迁移：32/32 通过。
- 发布性能门禁：23/23 通过。
- Node 原生模块 ABI 127：通过。
- Electron 原生模块 ABI 130：通过。
- 打包内容检查：通过，ASAR 共 3974 项，未发现开发期禁入文件。

## 大资料库性能

- 播放诊断 320,000 条记录查询：155.56 ms 与 142.19 ms。
- 播放诊断期间主线程最大间隔：20.14 ms。
- 资产中心 320,000 条视频、100 个来源聚合：1215.44 ms。
- 两项查询均在只读 worker 中执行，不阻塞 Electron 主线程。

## 打包与安装验证

- `release/win-unpacked/Local Video Manager.exe`：打包成功。
- `release/Local-Video-Manager-0.1.15-x64-Setup.exe`：生成成功。
- Packaged smoke：通过，资产中心 worker 与播放诊断 worker 均从 ASAR 成功启动和查询。
- Installer smoke：通过，覆盖安装、卸载和用户数据保留检查均成功。
- 桌面快捷方式 `C:\Users\test\Desktop\Video Manager (Dev).lnk` 已确认指向本次 `release/win-unpacked`。
- 从最新可执行文件启动成功，窗口标题为“本地视频管理”，窗口为最大化状态。

## 未验证事项

- 本次产物为未签名测试构建，未验证正式代码签名与 SmartScreen 信誉。
- 未在另一台全新 Windows 设备上执行人工验收。
- 桌面自动化能够确认窗口、进程和最大化状态，但当前环境未返回 Electron 可访问性树，未将人工视觉点击作为发布门禁。

## 剩余风险

- 用户真实资料库的聚合耗时仍取决于本机 SQLite 数据规模与磁盘状态；查询已移出主线程，因此不会形成同等程度的界面卡顿。
- 打包 smoke 中刻意触发的非信任页面 IPC 拒绝日志属于安全门禁预期行为，不是功能失败。
