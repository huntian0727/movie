---
date: 2026-09-25
branch: ai/playback-compatibility-v1
type: fix
status: completed
---

# 播放兼容性渐进优化 V1

## Context

用户希望更多视频留在映匣内置播放窗口中，同时优先保持网盘播放效率。开发前快照为 `2026-09-24_17-30-26-826_playback-compatibility-v1`，检查点为 `checkpoint-20260925-013023-3b91704-playback-compatibility-v1`。

对现有资料库只执行了 SQLite 只读汇总查询，没有读取视频内容：345,234 条在线记录中，344,438 条尚无 codec probe；其中 44,812 条 MP4/MOV/M4V/WebM 已标记元数据就绪但仍未探测编码。旧自动路由会把这批常见封装直接交给外部播放器。上述数量是当前资料库快照，不是保证可由内置播放器成功解码的数量。

## Changes

- 自动播放策略对元数据已就绪、编码仍未探测且未记录已知视频/音频编码的 MP4/M4V/MOV/WebM，先尝试内置播放器；真正发生播放错误时沿用既有 mpv/系统播放器回退。
- 内置播放窗口提供可见的“使用外部播放器”按钮；遇到网盘长时间缓冲而没有及时触发解码错误时，用户可自行切换，不必回到设置修改全局策略。
- 已探测出不兼容编码、探测失败或非上述封装的路由维持原状；明确指定 `mpv-first` 和 `native-first` 的设置语义不变。
- 不新增扫描、批量探测、完整视频读取、转码、数据库变更或云盘 API 调用。

## Verification

- 路由回归测试覆盖就绪但未探测的常见封装、已知 HEVC、AVI、探测失败及既有已知编码策略；播放器窗口集成测试确认本类记录获得内置媒体 URL。
- 路由及播放器定向测试通过；最终 `test:release-gate` 通过（75 个测试文件、695 项测试）。此前一次运行遇到既有资产中心 2 秒性能阈值的环境波动，单独复跑该项通过；另一次因本地 `better-sqlite3` 被 Electron ABI 重编译而中断，恢复 Node ABI 后复跑通过。
- Windows 桌面包已重新生成；`verify:artifact`、`test:packaged-smoke`、`test:installer-smoke`、`test:electron-smoke` 均通过。桌面快捷方式指向本轮 `release/win-unpacked/Local Video Manager.exe`，已从该快捷方式启动并核对主窗口和播放入口。
- 手工桌面测试未能确认一段未探测编码视频在当前机器上成功播放；本轮兼容范围不应被理解为所有视频保证内置解码。

## Risks and follow-up

- “未探测”不是“保证兼容”：不兼容视频可能先短暂尝试内置解码，再回退外部播放器；离线或严重缓冲问题可能不会快速触发解码错误。
- 这轮没有把 mpv 画面嵌入 Electron 窗口。当前环境没有可执行的 mpv，且 mpv Windows 嵌入涉及原生窗口层级、焦点、全屏、关闭清理及再分发许可；应先做独立原型和打包验证，再替换成熟播放链路。
