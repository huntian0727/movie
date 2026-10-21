---
date: 2026-10-21
branch: ai/native-runtime-candidate-integration
type: release-preparation
status: verified-private-qa-public-release-blocked
---

# v0.1.16 Windows 绿色版原生运行库：新候选构建与隔离验收

## 范围及不可越界事项

维护者 2026-10-21 要求尽快正式发行，当前只在**家用电脑** `MP2T8QB5` 开展工作；不在公司电脑运行。发行目标是 Windows x64 免安装绿色 ZIP，不替换用户每天使用的 `release/win-unpacked`、桌面快捷方式、SQLite 或实际媒体。真实 CloudDrive/115 删除未运行，待人工安全验收。新的原生构建仍属**私人 QA 候选**，不得通过复制或修改旧审批去获得公共发行资格。

## 实际生产构建及源码证据

- 基线代码 SHA：`3b73062e7008a34c8d1dba78bf09d6edb5ff3666`，修复 MPV 将 FFmpeg 弃用警告视作编译错误以及上游 Meson 失败被吞掉的问题。
- GitHub Actions 生产工作流 [39612312642](https://github.com/huntian0727/movie/actions/runs/39612312642)：`source-build` **SUCCESS**；相比上一轮 FAIL 的 38134981406，这是一次**真正成功的全新生产 CI 构建**。
- 新 `binary-source-map.json`：26/26 PE 原生文件逐个 SHA-256 核验；26 个文件依赖闭包全部解析，`closureValid=true`、`unresolvedImports=[]`；实际生产 Commit、25 份源码输入、编译工具链、配方、实际 FFmpeg 配置与 MPV 编译选项摘要 SHA 一致。`approved=false`、`sourceComplianceApproved=false` 保持不变。
- 原生运行库私有 ZIP：39,836,889 字节；SHA-256 `46b7a00a9275da307efc89e320ef0c5c87a846fd020e5d1167f838a0d394447a`。GitHub 附件只存加密信封；私人解密及 SHA/PE 复核在本机 `.tmp/native-run-39612312642/` 完成，不公开发布。
- 新源码伴随包：`.tmp/native-run-39612312642/Movie-Native-Runtime-39612312642-Corresponding-Sources-CANDIDATE.zip`，254,553,043 字节；SHA-256 `4325dc1a0d216ff89785337ab68833b0a5f6f35fcfd9795370802e1c6c621130`；包含 59 项，**没有可执行文件或 DLL**，未上传公共 Release。
- 实际校验生产源码 25/25 份，并恢复至新的隔离目录；未执行冷复编、未声称字节级完全复现。使用原 CI 日志与精确源码重新执行 `audit-native-source-licenses.py`，得到 244 个 MPV C 对象、298 个 shaderc 相关库源码、GPL-only 编译对象 0、11,380 条版权声明记录、5,953 份不同声明原文；该结果是工程证据，不是法律批准。
- FFmpeg 真正参数：`--disable-gpl --disable-nonfree --disable-static --enable-shared`，采用 libav* DLL 动态链接；Windows 直接运行 `ffmpeg.exe -version`、`ffprobe.exe -version` 成功，构造 64×64 PNG 并通过 ffprobe 验证成功。MPV 真实多编码视听仍需单独验收，不能从上述探测代替。

## 实际工程改动

1. `scripts/native-source-media.lock.json`：只把生产运行库指向新工作流和精确 SHA、成功的依赖闭包、当前版本、完整媒体 ELF/PE 对应 DLL；仍为 `CANDIDATE_NOT_APPROVED`/`distributable=false`。
2. `scripts/native-source-player-runtime.lock.json`：同一生产 ZIP 和对应源码，包含新 MPV 及依赖文件 SHA；仍未获公共分发许可。
3. `tests/scripts/sourceReleasePipeline.test.mjs`：保留 39 个旧 PE 安全批准记录，**明确要求旧批准与新生产锁不匹配，当前正式审批准入必须拒绝**；模拟的全批准对照测试仍保留，不允许通过更新旧证据哈希来伪装放行。
4. 本交付文档、`CHANGELOG.md` 建设维护记录和 `docs/ai/CURRENT-HANDOFF.md` 最新状态。此轮未修改功能/交互，`docs/USER_GUIDE.md` 不需要改；窗口左上角界面版本维持 v1.2，技术版本仍 0.1.16。

## 隔离构建与已测结果

- Windows 私人候选：`release/unsigned-test-build/拉面影视-0.1.16-x64-unsigned-test-build-Portable.zip`，214,807,755 字节，**当前预备 QA 文件** SHA-256 `7dd193f2ab2af8971357858065eabe083cdae9299ba9496f9f885a6b5d133a69`。此文件可能在后续干净提交复打包时变化，最终以实际 SHA/metadata 为准。
- `npm run dist:zip`、`npm run verify:zip`、`npm run release:metadata -- --portable`、`npm run test:packaged-smoke`：**PASS**。3469 ASAR 条目、17 份许可声明逐项检查，绿色包解压后检查 230 项文件；预览、Renderer/CSP、安全 IPC、数据库隔离等自动 smoke 通过。构建日志中有部分**预期 IPC 安全拒绝**及非致命 Electron/Vite 警告，不能因此虚构真实播放验收已通过。
- `tests/scripts/sourceReleasePipeline.test.mjs`：第一次因“旧批准应等于当前新锁”的过时断言 1 处 FAIL；修正该断言要求阻止旧批准继承后，**47/47 PASS**。
- `npm run test:release-gate` 修改审批测试后**完整 PASS**（包含 `npm run lint`、完整 build、Windows 路径、数据库迁移、性能回归、全部 Node 单测、媒体 67/67 契约测试和 29 项原生源码测试）；真实终态记录为 `wc_job_ukbAhzEPnrCjRBLD` 退出码 0。三个历史审批文件 `git diff --exit-code` 均无改动。
- **真实新 MPV 播放矩阵 5/5 PASS**：将 5 段中性视频及 24 个新源构建 DLL 复制到全新 `.tmp/native-run-39612312642/player-five-isolated-fixture/`，用真正的 `NativeHost.exe`+Electron+EmbeddedPlayer 测试 H.264/AAC、HEVC/AAC、HEVC/DTS、VP9/Opus、双音轨与字幕 MKV。每段均通过播放、暂停/恢复、seek、全屏视口、进度记录、切换会话和音轨/字幕测试；`production-service-test.json` 的 `pass=true`、5 个 samples 全 PASS、0 failures。**人工听觉/画质主观检查仍 NOT RUN**。
- 发行版 `.tmp` 私有测试资料库与真实视频数据库严格隔离；Windows 日常使用程序、实际快捷方式及其用户数据**未替换**。

## 无法自动绕过的正式发行阻塞

- `build/native-source-approval.json` 已记旧批 38134981406 的 39 个 PE SHA、旧源码、旧 review 文件，旧 `approved=true` **只适用于那批旧字节**，而不授权新候选。当前 `verifySourceReleaseApproval()` 明确拒绝，旧批准记录保留不变。
- `build/release-approval.json` 只绑定 0.1.15 与其 package-lock；`build/public-test-approval.json` 只绑定 0.1.15-beta.3；且没有当前稳定 Windows 11/标准权限的实际完整覆盖证据。不得无验证修改版本号/lock SHA、重命名 QA ZIP 或公开分发未经批准 DLL。
- 新运行库实际许可证组件、对应源码公开交付及可更换 DLL/权利等需完成当前批次逐项人工审阅、决策留痕，并基于最终实际二进制更新正式批准；候选仍未公开可下载。
- 后续：全量门禁 → 实测隔离五种编码的 MPV 播放与切换、真实稳定 Windows QA/数据迁移 → 维护者签署本批次来源与发行批准 → 从完全干净且固定 commit 生成正式包与对应源 ZIP → 同一次 Release 上传、检验 SHA、手册、许可证及公开链接。未经以上审批不创建正式 v0.1.16 Release。

## 回退与权限

- 开工前完整备份 snapshot `2026-10-21_14-42-15-269_native-source-runtime-qa-20261021`（SQLite 快速检查通过，视频 363,216）；Git checkpoint `checkpoint-20261021-224208-3b73062-native-source-runtime-qa-20261021`。
- 本地旧 `source-candidate` staging 已移到 `.tmp/native-run-39612312642/previous-native-source-*`；旧 QA 包已移动至 `previous-release-unsigned-*`。生产软件未覆盖，媒体未删除。
- 公开 0.1.16 Tag/Release：**NOT CREATED**；是否推送当前开发分支见最终交付状态，不能从旧文档推断。
