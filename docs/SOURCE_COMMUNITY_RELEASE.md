# 源码可追溯社区版的更新与发布

当前版本：0.1.15。当前路线：同一生产批次的共享 FFmpeg/FFprobe 与共享 libmpv 运行库，两个 variant 均为 `source-candidate`。这是绿色 ZIP 路线；`unsigned-community-qa` 文件名和窗口明确标记验收、未发布，使用正式社区版的资料库身份。

## 普通应用更新

1. 修改应用、更新版本与 lockfile，按 AGENTS.md 做开发备份、检查和正常提交。
2. 手动运行 **Source runtime community ZIP (manual, private delivery)**，选择开发分支与 `unsigned-community-qa`。
3. 工作流取回固定的运行库及对应源码，核对大小和 SHA-256，运行质量检查、打包、解压和程序 smoke。无需重编 FFmpeg、libmpv 或重复获取第三方源码。
4. 从验证资料与加密交付中取得具体 ZIP，进行本次改动相关的 Windows 验收。私钥只在维护者本机；GitHub 仅配置 RSA 公钥。
5. 对这个具体版本完成必要证据与最终公开授权后，才创建精确版本 tag、选择 `unsigned-public-release` 构建正式包，并发布程序、校验和、Release Notes、对应源码与适用许可材料。

工程流程已支持前四步的准备。当前所有真实发布批准仍为 false，尚未公开产品 Release；正式发布动作仍须遵循 `docs/legal/PERSONAL_RELEASE_FINAL_DECISIONS.md` 的最后确认。

## 哪些内容可以复用

原生组件没有变更时，`scripts/native-source-media.lock.json`、`scripts/native-source-player-runtime.lock.json`、固定原生 ZIP、固定源码 ZIP，以及针对这些具体哈希的源码许可审核可以复用。新版应用仍要通过应用测试、打包校验和相关 Windows 功能验收。修改 FFmpeg/libmpv/依赖版本、编译选项、NativeHost 或这些文件哈希时，应更新受影响的原生证据与批准记录。

`build/native-source-approval.json` 按程序中的完整路径覆盖 39 个 PE 文件；两个目录中相同 DLL 的不同安装位置分别核对。它独立于主 `build/release-approval.json` 的自有权属、依赖、Windows 验收和最终公开批准。旧 Lite/旧播放器的未批准记录不会替代源代码路线的 39 项批准，也无需为了这条路线重新完成旧静态 FFmpeg 路线的工作。

## 私有输入与交付

固定输入存放于已有 checkpoint 对应的私有 GitHub 草稿，`scripts/native-source-inputs.lock.json` 绑定草稿 ID、文件名、长度和哈希。实际取包探针已证明 GitHub 的只读 Contents token 返回 403；只有两个手动取包工作流的 job 请求读取私有草稿所需的 Contents write 权限，取包脚本仅执行 GET，不创建 tag、不发布 Release。其他工作流不因此提高权限。

下载脚本不向对象存储转发 GitHub token。公开仓库的 Actions artifact 只保存验证元数据及 RSA-OAEP/AES-GCM 加密的程序；不上传明文程序 ZIP或私钥。草稿保持私有也不代表它已经获得第三方分发批准。

常用入口：

- `scripts/prepare-source-release-inputs.mjs`：取回/核对固定输入。
- `npm run dist:zip`：按所选 release class 构建绿色包。
- `npm run verify:zip`：逐文件比对解压结果并实际运行 packaged smoke。
- `npm run release:metadata -- --portable`：基于已验证 ZIP 生成校验和与版本资料。
- `docs/ai/deliveries/2026-10-12-source-release-pipeline.md`：本轮实际检查、包与 CI 结果。
