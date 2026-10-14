## 当前正式绿色版：0.1.15

日常开发、候选验收与教程同步遵循 [2026-10-14 维护约定](DEVELOPMENT_AND_RELEASE.md)。普通用户阅读 [0.1.15 教程](user-guide/0.1.15.md)。下方 beta、旧批准状态和历史日期按各自记录保留，当前正式版本以本节和对应 Release 为准。

[正式版下载](https://github.com/huntian0727/movie/releases/tag/v0.1.15)。维护者选择当前 Windows 沙盒完成本次正式验收，不再以操作系统版本阻塞；实际覆盖范围见 docs/releases/0.1.15.md。

后续普通更新：修改和针对性验证 → 常规 CI/安全检查 → 更新实际版本与对应审批哈希 → 精确版本 tag → source-community-build 云端绿色包与私有草稿 → 成品与相关功能验收 → 发布。固定的 39 个原生文件不变时复用原生源码/许可审阅和已有声音确认；原生库变更时重新核对相关证据。正式版草稿由 stage-stable-portable-draft.mjs 暂存，核对版本、源码资产、commit、哈希；此步骤不自动公开。签名/安装器仍为独立范围。

# 源码可追溯社区版的更新与发布

当前版本：0.1.15-beta.3。当前路线：同一生产批次的共享 FFmpeg/FFprobe 与共享 libmpv 运行库，两个 variant 均为 `source-candidate`。这是绿色 ZIP 路线；`unsigned-community-qa` 文件名和窗口明确标记验收、未发布，使用正式社区版的资料库身份。

## 普通应用更新

1. 修改应用、更新版本与 lockfile，按 AGENTS.md 做开发备份、检查和正常提交。
2. 手动运行 **Source runtime community ZIP (manual, private delivery)**，选择开发分支与 `unsigned-community-qa`。
3. 工作流要求同一个完整 Commit 的最新主分支 Windows CI 与安全检查已成功；缺失、运行中、失败、取消都不能替代成功结果。随后取回固定运行库与源码并核对大小和 SHA-256，执行构建、Electron/Renderer 安全 smoke、ZIP 解压及实际程序 smoke。无需重编 FFmpeg、libmpv 或重复获取第三方源码，也不重复运行已通过的完整主 CI。
4. 从验证资料与加密交付中取得具体 ZIP，进行本次改动相关的 Windows 验收。私钥只在维护者本机；GitHub 仅配置 RSA 公钥。
5. 对这个具体版本完成必要证据与最终公开授权后，才创建精确版本 tag、选择 `unsigned-public-release` 构建正式包，并发布程序、校验和、Release Notes、对应源码与适用许可材料。

2026-10-13 维护者选择先发布公开测试版。`build/public-test-approval.json` 单独批准精确 `-beta.N` 版本与已有沙盒覆盖，稳定版批准仍为 false；不能用测试版批准生成稳定版或安装器。公开测试构建使用精确版本 tag、`unsigned-public-release`、配对源码运行库，需 `RELEASE_PUBLIC_TEST_ACKNOWLEDGED=true`，并通过许可/原生批准与精确 commit 主 CI；公开时必须附对应源码、校验和和范围说明，GitHub 标记 prerelease、不标 latest。程序仍由工作流加密交付，维护者本机解密并核验后发布，同一私有输入 draft 保持私有。

后续普通应用更新复用原生哈希对应的源码/许可审阅与音频验收，更新版本批准中的依赖、QA/决策哈希并运行应用 CI、打包 smoke 和变更相关验收即可。无需每次重新获取或重编整套 FFmpeg/mpv；原生组件或 NativeHost 有变更时才补相关验证。测试版发布流程不能自动提升稳定系统覆盖。

公开 beta 可预先准备私人产品草稿与 `SOURCE-PAIR.json`、精确应用源码及相同原生源码资产。云端 ZIP 校验完成后通过 `scripts/stage-public-test-draft.mjs` 直接上传私人草稿，减少本机大文件上行；它拒绝已经公开的 Release 和不匹配的源码/版本/批准，不发布 Release、不改 tag，也不覆盖不同的程序文件。维护者仍需核对具体 ZIP 后单独公开为 prerelease。

2026-10-12：用户指定本机沙盒，已完成云端工作流 `38237353737` 的具体社区 QA ZIP 功能与人耳声音验收（代码 `41b44c7`、SHA-256 `3a6e456e54aa332387cc228ad9041e7ce6066f45941b9437e4ffa961696e7b07`）。五类画面/声音、扫描/封面、播放控制、移动与删除绿色程序后的资料库保留均已记录。环境实际为 Insider Preview 26100.9606，未扩张成稳定普通用户系统结论。详见 `QA/2026-10-12-source-community-sandbox-evidence.json`；文档提交不会改变已验收的包，也不会自动打开正式发布批准。

## 哪些内容可以复用

原生组件没有变更时，`scripts/native-source-media.lock.json`、`scripts/native-source-player-runtime.lock.json`、固定原生 ZIP、固定源码 ZIP，以及针对这些具体哈希的源码许可审核可以复用。新版应用仍要通过应用测试、打包校验和相关 Windows 功能验收。修改 FFmpeg/libmpv/依赖版本、编译选项、NativeHost 或这些文件哈希时，应更新受影响的原生证据与批准记录。

`build/native-source-approval.json` 按程序中的完整路径覆盖 39 个 PE 文件；两个目录中相同 DLL 的不同安装位置分别核对。它独立于主 `build/release-approval.json` 的自有权属、依赖、Windows 验收和最终公开批准。旧 Lite/旧播放器的未批准记录不会替代源代码路线的 39 项批准，也无需为了这条路线重新完成旧静态 FFmpeg 路线的工作。

## 私有输入与交付

固定输入存放于已有 checkpoint 对应的私有 GitHub 草稿，`scripts/native-source-inputs.lock.json` 绑定草稿 ID、文件名、长度和哈希。实际取包探针已证明 GitHub 的只读 Contents token 返回 403；只有两个手动取包工作流的 job 请求读取私有草稿所需的 Contents write 权限，CI/取包脚本仅执行 GET，不创建 tag、不发布 Release。打包 job 另有 Actions read 用于核对当前 Commit 的 CI；其他工作流不因此提高权限。

下载脚本不向对象存储转发 GitHub token。公开仓库的 Actions artifact 只保存验证元数据及 RSA-OAEP/AES-GCM 加密的程序；不上传明文程序 ZIP或私钥。草稿保持私有也不代表它已经获得第三方分发批准。

常用入口：

- `scripts/prepare-source-release-inputs.mjs`：取回/核对固定输入。
- `npm run dist:zip`：按所选 release class 构建绿色包。
- `npm run verify:zip`：逐文件比对解压结果并实际运行 packaged smoke。
- `npm run release:metadata -- --portable`：基于已验证 ZIP 生成校验和与版本资料。
- `docs/ai/deliveries/2026-10-12-source-release-pipeline.md`：本轮实际检查、包与 CI 结果。
- `docs/legal/NATIVE-SOURCE-DISTRIBUTION-REVIEW.md`：同批原生组件的适用条款、文件级声明及拟采用的共享库发行条件。
- `scripts/prepare-source-review-companion.py`：从固定源码 ZIP、当前已提交代码和审阅文件生成新的私有源码审阅资料；校验归档并拒绝覆盖旧目录，不包含程序、不上传、不修改批准。
