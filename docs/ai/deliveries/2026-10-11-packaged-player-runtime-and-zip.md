---
date: 2026-10-11
branch: ai/packaged-player-runtime
type: fix
status: completed-with-release-blockers
---

# 首次使用播放黑屏修复与 ZIP 免安装候选

## Context

用户要求修复本机最终验收发现的黑屏，并补充希望直接解压使用的绿色版。保留既有 Electron / NativeHost / libmpv 架构，不将 HTML 控件或资料库重构。此前失败记录已保存为 `bb4185c`，本轮以其为基准。

开发前快照：`2026-10-11_03-33-45-894_packaged-player-runtime`；已推送 checkpoint：`checkpoint-20261011-113341-bb4185c-packaged-player-runtime`。真实资料库 345892 条，SQLite quick_check=ok。成功创建后执行工作区维护脚本，保留最新 3 份开发快照，全部哈希/数据库检查通过，移除 1 份旧快照，释放 0.876 GiB，错误 0。

## Changes

- 根因：旧包只包含 NativeHost，没有 libmpv；主进程从用户数据目录找 DLL，首次安装无法内嵌解码 HEVC/MKV。
- 增加固定来源/归档/DLL/上游通知哈希的运行库锁、下载与离线输入验证。NativeHost 和 libmpv 从程序 `resources/native-player` 定位，不借用 PATH、其他播放器或用户手工 DLL。开发态也使用同一固定暂存输入。
- 新增 `dist:zip`、`verify:zip`；ZIP 完整解压后逐文件比较清单与 SHA-256，再对解压后的 EXE 运行真实 packaged smoke。资料库仍在 Windows 用户目录；不是凭据和媒体索引可跨机器直接移动的完全便携资料库模式。
- 宿主和运行库只在 builder 基础配置声明一次，避免 extends 合并资源数组造成 Windows DLL 并发复制 EBUSY。
- 附带原始 Copyright / GPL / LGPL 文本及 MPV 来源说明；新增独立 libmpv 正式审批项和反例测试。公开批准字段、源码批准及人工干净 Windows 批准均保持 false，ZIP 与 NSIS 不能绕过。
- 更新 README、第三方说明及绿色版使用文档。没有调整视频扫描、数据库 schema、播放路由、原生宿主协议或用户设置。

## Verification

固定工具链：Node 22.23.1 / npm 10.9.8 / Electron 44.7.0 / Windows x64；离线 Electron ZIP 沿用既有固定 SHA。所有视频均为隔离中性合成素材，没有操作用户真实视频。

- lint/typecheck、build、Windows 文件 37 项、迁移 40 项、性能 31 项通过。
- 首次完整 Vitest：134 文件 / 1192 项，1191 PASS，1 项旧 scaffold 启动脚本精确字符串失败。更新这一断言后 scaffold 6/6、新增运行库/路径/正式审批相关 29/29 通过。最终 `npm test` 完整重跑：134 文件 / 1192 项全部 PASS，退出 0，219.50 秒；不把首次命令的退出 1 写成通过。
- 媒体候选与许可契约：59/59。8 份包内主要许可说明与源码逐字节一致，播放器 DLL 和三个原始通知分别匹配固定 SHA，包内 3462 个 asar 项，无开发资料库/环境文件/开发路径泄漏。
- 独立空暂存目录默认下载：实际下载固定 31,499,009 字节 MPV 归档，核对发行 API digest、解压 DLL 并校验全部原始通知成功。发现 7-Zip 动态库要求固定文件名后，改为在私有 build-only 缓存按 x64 配对；不依赖未执行的 npm 选择架构 hook。
- Electron native/main/preload/DPAPI smoke、renderer security smoke PASS。
- 生产 EmbeddedPlayer + 原 NativeHost + 固定 libmpv：H264/AAC、HEVC/AAC、HEVC/DTS、VP9/Opus、双音轨/字幕五种中性样本 PASS，failures=[]。包括暂停确认、seek、旋转、全屏控制遮罩与稳定 viewport、会话替换、stop/resume、进度保存。
- 实际 ZIP 解压：188 文件逐一 SHA 相同；解压 EXE 的首次启动/数据库/renderer/缩略图/预览生成/重启 smoke PASS。负面 IPC 拒绝日志是 smoke 主动验证的安全反例。压缩未结束时曾提前运行校验而遇到文件占用；压缩完成后实际重验通过。

从新建本机快捷方式 `拉面影视-绿色测试版.lnk` 启动解压出的 QA EXE，真实 UI 验收：

| 项目 | 结果 |
| --- | --- |
| H.265 MP4 | 出画面并推进；暂停帧时间 12.542 秒保持；快进至 22.542 秒正确目标帧；恢复后正常结束并自动播放下一 MKV |
| H.264 MKV | 出画面并推进；暂停 7.042 秒；快进至 17.042 秒目标帧；恢复后观察推进至 26.792 秒 |
| H.264 MP4 / 浏览器路线 | 出画面并推进；暂停 33.208 秒；快退至 23.208 秒、快进回 33.208 秒正确显示目标帧 |
| 运行库定位 | NativeHost 实际加载的是解压包内 `resources/native-player/libmpv-2.dll`；测试 userData/native-player 中没有 DLL |
| 正常退出 / 重启 | 3 视频、1 收藏、3 最近播放保留；SQLite schema 15、quick_check=ok，正常退出 marker=false；源文件 SHA 全部未改变 |

首轮功能验收是在提交前候选中完成，后续功能提交后的产物 commit、ZIP SHA 和准确解压路径以 `release/unsigned-test-build/portable-qa.json` 及包内 `resources/build-flavor.json` 为准；不把提交前的旧 marker 当成最终 Commit 证明。源码提交、最终重建及快捷方式复验结果以自动交付与本轮实际输出为准。

## Risks and follow-up

- 本轮提供的是隔离绿色候选，只读取 QA 资料库。原日用快捷方式与 `release/win-unpacked` 旧包没有被替换。**正式桌面版本尚未交付**，不能把候选当作旧版真实资料库升级包。
- 新 DLL 的具体 GPL/LGPL 构建适用条件、完整依赖对应源码、构建选项、通知与宿主组合许可没有获得批准；附带上游许可不等于获得再分发许可。FFmpeg Lite 尚待其剩余发行条件核验。没有公开 GitHub Release。
- 本机 Win11 Enterprise Insider 有开发环境，不能冒充没有 Node/FFmpeg 的干净稳定 Windows 验收。真实听音、长时间播放、真实 CloudDrive、HDR、DPI/多屏矩阵未运行。
- 当前 `readReleaseFlavor` 只解析 unsigned-test-build / signed-release，未来免费分享身份仍须补齐严格 community 身份的启动/数据隔离验收；本轮不通过解除正式门禁来掩盖这一既有待办。
- ZIP 使用 Windows 用户数据目录。移动视频/盘符或更换电脑需要重新添加对应来源，凭据仍受原 Windows 用户的 DPAPI 保护。
- NSIS 全套安装/卸载已在前一任务验收；本轮重点是 ZIP，没有将旧安装器冒充包含新播放器的安装器。将来生成正式 NSIS 时必须重跑安装/卸载与源数据保护。

回滚通过普通 revert 或开发前 checkpoint 恢复源码，不覆盖当前真实资料库，不强推 main。最终同步结果和旧 main 备份标签由交付脚本实际输出记录。
