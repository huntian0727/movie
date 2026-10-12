---
date: 2026-10-13
branch: ai/native-source-license-closure
type: fix
status: partial
---

# 同批原生运行库：文件级声明与源码审阅材料

## Context

用户要求继续完成 GitHub 发行准备。上一轮已完成具体云端绿色包的本机沙盒画面、五类人耳声音与资料库保留验收。本次集中处理固定运行库的版权声明、源码材料和可复用的核验记录，不改变播放器实现。

开发前快照：`2026-10-12_15-43-38-361_native-source-license-closure`；checkpoint：`checkpoint-20261012-234333-e7d5df1-native-source-license-closure`。工作区干净后创建，随后维护脚本校验最新三份快照与三个升级备份，删除一份旧开发快照，回收 0.877 GiB，无错误。

## Changes

- 根据实际生产 CI 日志对照 25 份固定源码输入，映射 244 个 libmpv C 编译文件及 298 个 shaderc 库构建源码，不把 `gpl=false` 本身当作许可证授权。原 CI FAIL 与 closure-false 记录不改写。
- 补齐 Chromium 音频算法的 BSD 声明、mpv ISC 声明及其他输入的文件级版权头。补充文件保留 11359 条记录、5936 份去重原文，区分编译对象/字面 include/仅留存源码，不把未链接的测试或 GPL 实现误认成 DLL 的条款。原有 95 条完整许可记录与源归档哈希不改动。
- 新增组件发行条件审阅表，明确 LuaJIT 静态进入 libmpv、shaderc 的递归库材料、FreeType FTL、GCC 运行库 exception，以及系统依赖与实际分发文件的区别。记载 LGPL later-version 的拟发行条件，原始授权不改写；完整 GPLv3/LGPLv3 从固定 FFmpeg 源码逐字复制。
- 39 个源码批准位置已关联这份审阅表的固定哈希，所有 sourceComplianceApproved、原生 approved、总 approved 和 manualQaApproved 仍为 false。
- 增加源码审阅资料生成器：只从精确源码 ZIP、已提交代码与审阅资料生成新外部目录；包含对应原生源码、NativeHost 源码/编译 pin 与独立的 exact-commit 应用源码 ZIP。拒绝篡改输入、程序型顶层输入、路径异常、脏工作区及覆盖现有目录，不上传或批准发布。
- 打包声明校验从 12 项扩展为 17 项，新文件随 docs/legal 自动打包，并继续要求 SHA-256 与源码逐字匹配。正式 source 批准另绑定 20 份审阅文件/NativeHost 构建资料的摘要，防止只保留审阅表哈希却替换许可正文。上游 TXT 按原始字节，自有文本仅统一 CRLF/LF 作审阅摘要，安装包对构建源码的原始 SHA 校验不变。新增生成器/路径/许可声明测试接入原生源码测试入口。
- 关于与许可证页面增加 libmpv/MPlayer 版权、按具体构建适用的 GPL/LGPL 条款、共享库修改/调试权利与 FreeType 贡献者署名。不把旧播放器与源码播放器误标为同一种许可证。

## Verification

- 25 个实际源归档的长度/SHA-256 核验：PASS；244 个 libmpv 编译对象全部解析、GPL 专用编译源为零；298 个 vendor 库构建源码全部解析；生成 11359/5936 补充记录：PASS。
- 原生源码与审阅生成器 Python 测试：27 PASS（原 12、许可审阅 10、审阅资料 5）。新声明逐字节校验 Node 测试：3 PASS。
- 本次新增 ZIP 路径测试最初发现 Windows ZipInfo 会规范化反斜杠；生成器改为检查 orig_filename，原样构造的反斜杠成员现已拒绝。没有删测试或放宽输入条件。
- 本轮锁定 Node 22.23.1/npm 10.9.8：lint、typecheck、build、Electron smoke PASS；Vitest 138 文件 / 1250 测试 PASS，媒体合同 65 PASS，Python 原生源码/审阅测试 27 PASS。正式资料变更、审阅行缺失/重复、正文篡改和上游 TXT 换行变化均有拒绝验证。
- 实际新包与独立源码资料需在这次提交成为干净 checkpoint 后生成；结果追加在本记录，不套用上一轮包的材料校验。自动交付仅在以上七项完整检查本轮通过后使用 SkipChecks，避免重复跑相同检查。
- 关于页调整后再次完整执行七项检查：PASS，仍为 138 / 1250、65、27；渲染构建包含新署名。除关于页署名外，播放、扫描、资料库逻辑和 NativeHost.cs 不变；没有重编 FFmpeg/libmpv，没有声称冷重编译/逐字节重现通过。E2E 脚本不适用。
- 干净代码 checkpoint `39571beaf47b25b72acac5fcc9962b933bc10318` 的实际 dist:zip、verify:zip、portable metadata：PASS。新私有绿色包 SHA-256 `a0f87eef5e9698351297506d68f0bdb5c6ef37d6fab0f20fd2758f08f5e27460`，228 个解压文件逐一匹配，ASAR `dfc9c582520a5fda2426b61b3594051533737b78b23dd48bfb6f43a2c52fca2b`。17 份声明原始字节匹配；程序/NativeHost NotSigned，publicReleaseApproved=false。
- 新包的全部 39 个 PE 路径与已验收的固定哈希相同：PASS。正常退出旧沙盒程序后，从新独立只读目录启动新包；GUI 保留 10 个视频、2 个目录、1 个收藏、7 条历史，实际打开关于页看到 libmpv/FreeType 新署名：PASS。沙盒未重启，未动真实视频或清空资料库。五类声音确认仍对应未变的原生运行库，不声称本轮重听了五类声音。
- 独立源码资料实际生成及 CRC/逐文件哈希：PASS。原生审阅 ZIP 为 257306641 字节，SHA-256 `6d742e544045e4c9f1e64912394250654860daaa766f550dc16eaf01ba42d0d4`；对应 checkpoint 的应用源码 ZIP SHA-256 `f1fc5bbc2955696907b3960e8af68989374ef81726f380146cc719f346d58c9e`。包含固定原始源码 ZIP、审阅文件及 NativeHost 构建资料，不包含程序或私钥，不上传公开资源。材料生成器确认输入源 ZIP、两个运行库 lock 与 NativeHost 的哈希一致。
- 工程提交 `e8189f5` 的 GitHub Windows CI `38280756258` 与安全审计 `38280756274`：PASS。关于页提交 `39571be` 的本地七项检查已通过；该提交的远程 CI 另查状态，不能借用 e8189f5 的结果。

## Risks and follow-up

技术材料的整理不等于公开分发批准。当前记录保留许可证选择与共享库替换/源码访问条件，最终发行需明确采用这些条件并公开对应源码。预览版沙盒验收不替代稳定 Windows 11 标准用户覆盖，最终公开确认仍未取得。

旧云端 QA ZIP 保留原哈希，不能声称它已含这次新增声明；新包必须另做解压、逐文件与 notices 校验。原生运行库保持原字节时，五类声音确认可以作为这些固定运行库的已有证据，相关新增验证集中在这次材料差异。日常桌面快捷方式未更新，**桌面版本尚未交付**。
