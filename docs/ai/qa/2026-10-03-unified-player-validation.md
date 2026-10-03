# 统一播放器补充验证（2026-10-03）

## 范围与基线

- 分支：`ai/unified-player-validation`；业务基线：`af3cb189d4f4aae0399cd9652f35f3d7f7918f3c`，任务开始时与远端 main 一致。
- 本轮只增加隔离测试脚本和报告，不修改播放、扫描、文件管理、数据库结构或用户设置。
- 业务基线的实际 `release/win-unpacked/拉面影视.exe` 用独立临时 userData/SQLite 验证 UI；没有访问真实资料库或删除用户文件。
- 测试媒体为五个本机生成的中性色条/计时/音频/字幕样本，长度约 12 秒。未执行长时间播放。

## 五项验证结论

| 项目 | 结果 | 边界 |
|---|---|---|
| 真实 CloudDrive 播放、拖动、弱网恢复 | NOT RUN | 尚无用户指定的普通测试文件；本地样本不等于网盘测试 |
| 音频输出、音画同步 | 技术短样本 PASS；人工听音 NOT RUN | 五种样本均 WASAPI / 48kHz，短时最大绝对 avsync 约 41.7ms；不代表实际扬声器听感、长时同步或所有音频格式 |
| 原生/MPV 混合列表切换及全屏 | 窗口切换 PASS；全屏部分 FAIL | 浏览器全屏起始路径可退出；MPV 窗口全屏起始路径切回原生后无法正常退出 |
| 音轨、字幕与界面 | 引擎 PASS；UI 存在缺口 | 切第二音轨、启用/关闭字幕可用，实际内嵌字幕可见；统一 PlayerPage 尚无音轨/字幕选择控件 |
| 文件缺失、无效媒体、进程崩溃、快速切换 | 隔离引擎 4 场景 PASS | 错误报告、再次打开、连续 8 次会话替换、旧 stop 不终止新会话、子进程释放均通过；不等于所有网络故障 |

## 已复现问题 P1：跨解码模式全屏无法退出

复现步骤（实际桌面包、auto 策略、暂停样本）：

1. 窗口状态打开 HEVC/AAC，显示“内嵌解码”。
2. 点击全屏按钮，进入 MPV 所使用的 BrowserWindow 全屏。
3. 打开原播放列表，点击 H264/AAC，切回浏览器解码。
4. 点击右下全屏按钮，随后再次点击；播放窗口仍占满屏幕，不能正常恢复窗口。画面和列表仍可使用，并非整个应用死锁。
5. 对照：从 H264 的 DOM 全屏起始，切到 HEVC 再切回 H264，点击退出可恢复窗口。

代码依据：`src/renderer/components/PlayerPage.tsx` 的 `toggleFullscreen` 在内嵌模式使用 `embedded.send(fullscreen)`，原生模式仅依据 `document.fullscreenElement` 调用 DOM Fullscreen API；`fullscreenchange` 也只读取 DOM 状态。两种全屏状态未统一，切换后原生按钮不能清除已有 BrowserWindow 全屏。

建议修正：由播放器窗口统一管理进入/退出全屏并发布真实状态；保留现有页面和解码策略，只修全屏适配、切换清理和状态同步。增加双向混合路由全屏回归测试。**本轮未实施。**

## 功能缺口 P2：统一 UI 未提供音轨/字幕选择

生产引擎已有 `audio-track` / `subtitle-track`，隔离实测选第二音轨和关字幕成功；但统一 `PlayerPage` 无对应选择入口。不能把引擎支持写成“用户界面已支持”。建议小型控件复用现有状态/命令，不重写播放器；外置字幕另行验证。本轮未新增控件。

## 可复现脚本与证据

`scripts/test-unified-player-validation.mjs`：需先构建业务代码/NativeHost，并使用 Electron ABI 的 SQLite 依赖及已有 libmpv 运行时。

```text
node_modules/electron/dist/electron.exe scripts/test-unified-player-validation.mjs --fixture-root=<中性样本目录>
```

样本目录必须包含 `samples.json`、`media-feature-samples.json` 和运行时；脚本仅允许五个位于该目录内的样本，创建独立临时数据目录，输出脱敏数字与结果，不提交媒体、数据库或原始日志。`--seed-ui` 只生成临时资料库以测试当前生产桌面 UI，不修改真实设置。

首次完整引擎报告 `lamian-unified-validation-D0WygO/report.json`：9/9 场景通过（五种媒体 + 四种异常/切换场景），无失败。五种媒体 startMs 为 1120–1322ms，该值包含从 1 秒位置开始播放到时间推进超过 1.6 秒的观察，不是严格首帧延迟。每个样本仅读取 5–6 个同步快照。

脚本随后补充 avsync ≤100ms 和快速切换后进程释放的断言；最终 `lamian-unified-validation-myToQM/report.json` 仍为 9/9 PASS，最大绝对 avsync 41.665ms，退出码 0。本轮完整质量门禁 92 文件 / 797 测试、构建与 Electron smoke 通过，详情见交付记录。**自动测试尚未覆盖已复现的跨模式窗口全屏问题，绿色测试不等于该问题已修复。**

实际 UI 验证使用 computer-use，未自动化真实删除。测试关闭后只读检查未发现 NativeHost 残留；未对其他用户进程执行清理。

## 发布判断

不能宣称“五项全部通过”或“所有视频保证可播”。建议先修 P1；补充真实 CloudDrive 普通视频和人工听音后，再判断播放器增强的完整验收。P2 可按需求安排，但必须明确暂不支持界面选择。
