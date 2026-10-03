# 内嵌 MPV 个人试用集成

## 范围与入口

设置 → 播放偏好 → **内嵌 MPV（试用）**。默认仍为 `auto`，原生优先、外部 MPV 优先和自动规则保持原有语义。播放窗口新建独立 `EmbeddedPlayerPage`，视频原生子窗口与 React 按钮区分开布局，不在视频上方覆盖 DOM 控件。不要将本轮称为稳定默认发布。

支持：播放/暂停、进度、±10 秒、音量、90° 旋转、全屏、队列切换、音轨选择、字幕选择、手动加载 SRT、重新加载、退回原播放方式、调用已有外部 MPV。长时间播放及用户实际听音未验收，不承诺所有格式均可播放。

## 架构与边界

`EmbeddedPlayerPage` → preload 类型化 `player:embedded` → 主进程 `EmbeddedPlayer` → 自有 C# `NativeHost.exe` → 本机 libmpv。解码位于独立子进程，不给 Renderer 暴露数据库、文件路径参数、HWND、DLL 路径或任意 MPV 命令。

- IPC 通过既有 trusted handler，并额外限制为当前播放窗口的 WebContents；严格 Zod 请求结构。
- `start` 只接受视频 ID、会话 key、是否播放和可选起始时间；文件路径只能从现有资料库查询。
- 每个页面会话独立 key，每次切换 native token 递增，旧停止请求及旧快照被丢弃；原生控制串行，连续跳转按种类保留最新待处理目标。
- 控制完成须收到 ack、同 token、非 seeking、实际 restart 和目标位置/角度。UI 不把已提交命令等同于完成。
- 每 250ms 仅有一个状态查询在途；原生快照 200ms。视频渲染不经过 React 图片更新。
- 初次读取/持续缓冲最长 30 秒；原生消息断流 10 秒、启动就绪 10 秒、跳转/旋转 30 秒均提供失败状态及手动回退，不自动切换播放器。
- 进度每 5 秒及停止/替换/退出时通过已有播放历史保存；默认恢复查询沿用最近 200 条历史的现有接口。历史之外的视频不保证自动恢复，但明确传入位置不受该限制。DB schema 不变。
- 回退/外部播放传递当前实际位置。全局退出先保存进度，再关闭原生进程；正常退出等待，4 秒强制结束，8 秒兜底。不得按进程名称关闭其他 MPV。
- 不读取或修改扫描、重复删除、目录移除、媒体缓存架构。普通浏览不启动 NativeHost。

## 运行库及打包

Windows x64，构建脚本使用系统 .NET Framework C# 编译器，生成自有 `native-bin/NativeHost.exe`。该目录忽略，`package:dir`/`dist:win` 编译并放入 `resources/native-player/NativeHost.exe`。

libmpv 来自开发前已实测的本机运行库。本轮不下载新运行库，不提交 DLL，不在公开安装包中附带第三方 DLL。个人机器部署至现有 userData 的 `native-player/libmpv-2.dll`；读取失败时明确提示配置或回退，不隐式下载。未来要跨机器发布，需要补齐运行库选择/安装说明和再分发材料。

本机验证运行库 SHA-256（这是 DLL 完整性记录，不是视频重复验证）：`8ca42a74311b813abc21f4264e7ed5f12a16419596bcbda96e49f10f8187befe`，120,781,312 字节，MPV `v0.41.0-1092-g3186d369f`。

[MPV 官方版权说明](https://raw.githubusercontent.com/mpv-player/mpv/master/Copyright)说明默认 GPL 构建与排除 GPL 代码的 LGPL 构建存在区别，所链接 FFmpeg 等依赖也影响再分发条件。本轮不将下载来源或“个人使用”视为完成许可证审查。公开内嵌运行库发布仍待准确构建来源、依赖、许可证、源码及通知材料核查。

## 验证脚本

`node scripts/test-embedded-player.mjs --fixture-root=<隔离中性样本目录>` 必须以 Electron 执行。使用实际生产服务与自有 NativeHost、独立历史 ledger，不接触正式 DB。样本列表 `samples.json`、`media-feature-samples.json` 由隔离验证准备，含 name/path；不进入仓库。验证报告仅输出中性样本名和结果。

验证五类样本：H264/AAC、HEVC/AAC、HEVC/DTS、VP9/Opus、双音轨和字幕；短时验证播放、暂停、连续跳转合并、旋转、音量、全屏、替换会话、过期 stop 隔离、进度保存、轨道切换。实际听音、长时间播放仍标为 NOT RUN。桌面验收须从实际快捷方式操作，不能以该脚本替代。

## 回滚

用户即时回退：设置改回“自动选择”，或播放窗口点击“退回原播放方式”。没有扫描迁移或 DB 迁移。代码回滚通过开发前 checkpoint/backup-main 新建修复提交，不强推 main；恢复正式数据库须先备份当前数据，不能为播放器回退自动覆盖整个资料库。
