---
date: 2026-10-11
branch: ai/traceable-player-runtime
type: chore
status: partial
---

# 原生播放器源码留存构建流程

## Context

用户选择继续 GitHub 发布。历史 libmpv 构建依赖材料是主要阻塞，重复获取同名源码不能证明对应关系。本轮开发前快照 `2026-10-11_10-05-50-607_traceable-player-runtime`，checkpoint `checkpoint-20261011-180545-6eb39a6-traceable-player-runtime` 已推送，345892 条数据库 quick_check 正常；随后维护脚本校验最近三份开发/迁移快照、清理一份旧开发快照，错误零。

## Changes

- 核验官方 LGPL 候选 ZIP SHA `876619ea77c1891af92500d65939b44ea7bb32175356a740e9d86b6813483b4d`；隔离 DLL 初始化成功，实际 `gpl=false`，但仍静态链接依赖。没有替换当前运行库。
- 新增固定上游配方、动态库、依赖编译前源码留存、工具链源码与二进制导入闭包的构建流程。原始配方结构或 SHA 变化时拒绝执行修改。
- 新增仅手动启动的 CI，程序候选只以接收者公钥加密上传；私钥仅存在本机忽略目录。保留源码证据及机器哈希，未添加 Release 发布权限。
- 增补源码档案与加密安全测试，接入现有 release gate。应用源码/界面未修改；新增显式选择新运行库的私有 QA 打包入口，日常桌面入口未替换。
- 增加已采集源码的恢复入口：校验全部档案后创建新目录，恢复实际依赖与递归子模块，保留编译选项，不重新解析浮动上游分支、不覆盖原目录。
- 新运行库独立锁包含 24 DLL 与三份 mpv 上游通知，ZIP/每文件 SHA 固定；仅从本机留存的精确 ZIP 暂存，拒绝未知变体、额外 DLL、缺失/篡改文件、路径逃逸及非 x64。打包仅复制一次运行库，在 flavor 记录变体、锁哈希及工作区是否有未提交修改。正式发行拒绝此实验变体。
- 扩展包/ZIP 的运行库验证与通知验证；补入实际候选说明，区分新播放器与仍单独选择的 Lite FFmpeg CLI。未混淆旧运行库的源码声明与新候选。

## Verification

- 新增源码留存 Python 初轮 6/6，后续系统依赖/GCC 精确版本及恢复回归扩展至 12/12；私有候选 Node 5/5 测试：PASS。递归 Git 源码与原字节保留、档案替换拒绝、恢复不联网/拒绝成员逃逸/拒绝覆盖已有树、错误接收者/篡改密文/私钥作为公开输入拒绝均实际执行。
- 实际固定原始脚本 SHA 校验及转换：PASS。首次交叉构建 [38132060437](https://github.com/huntian0727/movie/actions/runs/38132060437) 完成全部依赖及 libmpv/FFmpeg 编译，在导入闭包检查失败：未将 Windows 自带 `AVICAP32.dll` 识别为系统组件。该任务整体 FAIL，未取得运行库候选，不称为打包通过。
- 本机确认 AVICAP32/AVIFIL32/MSACM32、D3D9、MF/MFReadWrite、UXTheme 均存在于系统目录，签名 Valid，签署者 Microsoft Windows。补入明确系统清单；未知依赖仍拒绝，改为一次报告全部未解析项。编译完整而包装失败时保留加密恢复材料，闭包有效性单独记录 false。
- 首轮源码证据 160767938 字节下载成功，25 份实际输入档案原字节/SHA 全部核验；85 份按文件名找到的版权/许可文本仅是留存数量，不当作法律审查通过。实际 FFmpeg 关闭 GPL/nonfree，mpv `gpl:false`、共享库、D3D11 enabled。证据与原始日志只保存在忽略目录，没有真实媒体或私钥上传。
- 从这 25 份实际档案恢复源码目录成功，shaderc 的 SPIRV-Tools 子模块、libplacebo 和 AMF 头文件实际存在；恢复后的 shell 配方 `bash -n` PASS。此项未在 Linux 再编译，不写成可重复构建通过。
- 查明 Ubuntu MinGW 包版本 `13.2.0-6ubuntu1+26.1`；其包装源码依赖 `gcc-13-source`。新增底层 GCC 精确版本/DSC 哈希采集；本机首次连接失败后，第二轮 CI 已取得 GCC 13.2.0-6ubuntu1 的 orig/debian 档案及 DSC，本机下载后全部 size/SHA 核验通过。没有拿 gcc-mingw 包装源码冒充 GCC 源码。
- 第二次实际构建 [38134981406](https://github.com/huntian0727/movie/actions/runs/38134981406) 完成编译，整体仍 FAIL：CFGMGR32/SHCORE 两项系统导入未识别。这次完整 ZIP 保存在加密恢复材料中；本机解密，核验 26 个 PE 的哈希/实际导入表、25 份输入档案、工具链清单、配置与源码采集器绑定。确认两项 System32 文件 Microsoft Windows 签名 Valid，未向包中复制系统文件。原始闭包 false 的 map 未改写，本机派生核验后无未知依赖；已补充系统清单回归，不为此再次冷编译。
- 实际候选 libmpv SHA `53b32ae12a71733ba31374fcb2bab1d987f9aa266374a00215ce829210fc441d`；libmpv API 2.5、版本字符串 v0.41.0-UNKNOWN。FFprobe 与 FFmpeg 对五份中性样片探测/两秒视频音频解码 PASS；headless libmpv 加载、暂停、跳转、推进 PASS，明确不把 vo=null/ao=null 当成画面/听音验收。
- 新 DLL 对现有 Electron 生产服务的两套回归 PASS：九个加载/失败恢复/快速切换场景，及五种样片的暂停/快进/旋转/全屏裁剪/音量/进度保存/停止续播。WASAPI 输出正常、最大观测 A/V 差约 42ms。自动测试的 subtitle rendered 字段来源为 sub-text，只说明文本解码；随后实际窗口两帧可见活动画面与 `INNER subtitle - 内嵌字幕测试`，补足像素显示确认。
- 2026-10-11 用户对刚编译新运行库的 AAC、DTS、Opus 循环样片明确回复“三类都正常”；仅归于本机这套新候选，未转借历史沙盒确认。
- 首个新运行库绿色 QA 包 ZIP SHA `f3cd13dad57653c7144918d3c9b89f6e41b923b3f42b2888c2fcf1c65ad6fdf7`，217 个文件逐字节相等，九份通知 SHA 一致，包内创建/重开数据库、扫描、预览、IPC/CSP 安全检查 PASS。首次包来自 95b0d7f 加本轮明确列出的未提交打包更改，不冒充该提交的干净产物；补充 dirty metadata 后将从最终提交重打。
- 直接启动解压目录 portable-qa-lE0Y01 下的程序，隔离五视频资料库；实际 H.265/AAC 显示内嵌解码并播放到下一项，H.265/DTS MKV 帧从 00:00.042 变至 00:11.292，暂停成功。NativeHost 实际从该解压包 resources/native-player 启动，使用该包运行库；没有读取日常资料库。
- 新一轮完整检查：lint/typecheck/build/Electron smoke PASS；Vitest 134 文件 / 1206 项 PASS；媒体契约 65/65、源码构建 Python 12/12 PASS。播放器新增依赖缺失/篡改、非 x64、额外 DLL、路径逃逸与正式发布阻断验证通过。独立 E2E npm 脚本仍不适用。
- 私有源码审阅附件已生成，255285742 字节，SHA `b0caa9b90695515b97ddae5de7b3569ea1f867a09d2680ec488f81fa3770b77f`；包含原始完整源码证据 ZIP、原始二进制 map、源码恢复入口、95 份通知记录/70 份去重全文和 16 个生产者二进制组件组关系。实际补足 FreeType FTL/credit、GCC Runtime Exception、winpthreads 及 AMD/NVIDIA 头文件通知。ZIP CRC、内嵌完整源码 ZIP SHA 和每份通知 SHA 全部验证；无 Movie 程序候选、私钥、个人视频或数据库。通知数量是材料清单，不代替逐组件适用性审查。
- 代码 `faf830ed32a21826caf785fbfbfea1718fef9523` 已普通推送分支及 main，备份 `backup-main-20261011-223320-95b0d7f`。Windows CI 38147665737（Node 安全/完整回归及 Electron smoke）、Security audit 38147665730 均 SUCCESS。
- 从 faf830e 干净工作区重打后最终绿色 QA ZIP 224633609 字节，SHA `7311163a94931adbdcb618f39a11d61e71b91d974692b87752dea82b5402430e`，flavor.workspaceDirty=false、commit=faf830e。219 个解压文件逐字节核对 PASS，11 份许可材料 SHA 一致；portable-qa-BaPwzb 实际创建/重开资料库、扫描、缩略图、工作线程和安全 smoke PASS。app.asar SHA 保持 `b2108a29622c7e142ca3985a57d08bfe0366dc8ffcd41cadbc7be6c788705ab4`。本段为打包后的验证记录，后续仅文档提交不改变该程序包的代码来源。
- 新运行库补测真实 2560×1440 HEVC/PCM A-law 测试副本：ffprobe/ffmpeg 解码、mpv 加载/跳转/推进/暂停 PASS；duration 468.855 秒。实际窗口两帧可见画面与视频内时钟推进。此轮实际音量为零，不将旧运行库的 PCM 听音确认转借为新库确认；源文件和现有沙盒均未改动。
- 锁定 Node 22.23.1 / npm 10.9.8 完整检查：lint、typecheck、build PASS；Vitest 134 文件 / 1204 项 PASS；Electron smoke（SQLite/DPAPI/三身份/移动目录/preload/主进程）PASS；媒体候选契约 65/65 PASS；新源码构建测试 6/6 PASS。独立 E2E npm 脚本不存在，记为不适用。
- 原始配方转换后 `bash -n`、工作流各 shell 步骤语法及 YAML 解析 PASS。真实 CLI 在 `.tmp` 中生成私钥、公钥验证、加密/解密并核对原字节 PASS。完整质量检查后提交脚本 ValidateOnly PASS；使用本轮等价检查的 `-SkipChecks`，正常推送并备份旧 main。

## Risks and follow-up

- 本机中性样片、绿色 QA 包及一份真实 1440p HEVC 已验证；其它真实长片、1080p/4K及新库 PCM 实听、稳定 Windows 11 公开身份验收仍待完成。第三方发行审核尚未批准，不把本机功能测试当作许可批准。
- 正式发行接入仍待完成：目前 source-candidate 是显式私有播放器变体，CLI 仍为单独选择的 Lite；已编译的动态 FFmpeg/FFprobe 尚未成为实际应用媒体工具。后续可复用本次完整原生构建与源码，接入同一来源的 CLI，避免继续依赖未闭环的旧静态重链接路线。正式门禁必须覆盖全部新 DLL 与准确来源，不允许只批准主 libmpv。
- 原有公开发行审批及候选锁保持未批准。没有公开程序附件、发行 Tag 或 GitHub Release。
- 第一轮代码 `2c74079` 已普通推送分支及 main，备份 `backup-main-20261011-182759-6eb39a6`；Windows CI 38132047435、安全 38132047434 均成功。打包修正 `dac070d` 已普通推送分支及 main，备份 `backup-main-20261011-191614-2c74079`；Windows CI 38134948147、安全 38134948298 均成功。恢复入口 `95b0d7f` 已推送两分支，备份 `backup-main-20261011-193721-dac070d`；Windows CI 38136241830、安全 38136241823 成功。原生编译任务的 FAIL 与应用 CI 的 PASS 独立记录。
- 稳定 Windows 11 普通用户和最终公开身份 ZIP 验收仍待完成。此次为构建工具及隔离绿色候选验证；日常桌面快捷方式仍用旧包，桌面版本尚未交付。现有 Windows 沙盒未重启或清空；D200707 尚未访问。
