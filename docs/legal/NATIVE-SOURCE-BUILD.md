# 从源码构建 Windows 原生候选

此流程用来替代缺乏完整实际依赖材料的历史播放器构建。它生成独立候选，**不替换当前播放器、不批准发行、不创建 GitHub Release**。

现有 libmpv 的静态依赖版本无法仅凭浮动配方准确还原。2026-10-11 在本机取得 mpv 官方 LGPL 候选并通过 mpv API 初始化：DLL SHA-256 `5191a1f28e8e0cde0caf0489404acac8862af7060193c0ac27b9692b1fb48bf4`，实际 `-Dgpl=false -Dprefer_static=true`。它仍需要完整依赖源码，因而没有替换已测试的旧 DLL。[官方构建脚本](https://github.com/mpv-player/mpv/blob/d94d09581474d6e91d7a0e544b07de4eb8b07a9f/ci/build-mingw64-full.sh)也明确使用静态依赖。

新工作流 `native-source-candidate.yml` 使用同一固定 mpv 提交的动态 MinGW 配方，核验两份原始脚本 SHA-256 后才应用修改：FFmpeg 关闭 GPL/nonfree，生成 FFmpeg/ffprobe；mpv 关闭 GPL、JavaScript 和 subrandr，保留 libass、LuaJIT、D3D11、shaderc、SPIRV-Cross。这一组候选功能尚需真实播放与字幕回归，不能把旧候选的 QA 直接转给新构建。[FFmpeg 官方说明](https://ffmpeg.org/legal.html)将动态链接和准确对应源码列为推荐发行路线；使用动态库仍需核对全部依赖及适用通知。

每个依赖在首次编译前保存实际源码树。源码树包含递归子模块，排除 Git 元数据和构建目录；记录各 Git 仓库的完整提交与来源，保留下载档案原字节，并对每份档案计算 SHA-256。首次构建可能解析浮动上游引用，但保存的是当次真正使用的源码，而非事后再下载同名版本。`inputs.json`、准确 FFmpeg 配置、mpv build options、二进制哈希及导入表共同绑定当次结果。没有使用恢复的预编译依赖缓存。

工具链同时记录安装包版本、原始 copyright、准确 Ubuntu source 包及 SHA-256。另按实际 MinGW 二进制包版本收集其底层 GCC 源码：`gcc-mingw-w64` 的源码包只是构建包装，不能当作 GCC/libstdc++ 完整源码。用 Launchpad 精确版本发布记录和 DSC 的 SHA-256 核验底层源码，不以当前最新版代替。宿主构建工具与实际随包 DLL 的关系仍需人工审查；保存工具链材料不等于自动证明许可证全部满足。未做位级可重复构建对比。证据可能包含未实际链接的编译依赖，不能把档案数量当作 SBOM。

## 运行与取得私人候选

1. 使用锁定 Node 在忽略目录生成接收者密钥：`node scripts/private-native-artifact.mjs keygen .tmp/native-candidate-keys`。私钥只保留本机，不提交、不放到 GitHub 输入、变量或日志。
2. 将 `candidate-public.pem` 的 Base64 传入手动工作流参数 `recipient_public_key_base64`。工作流权限仅为 `contents:read`，没有 Release 发布或审批写入权限。
3. 工作流公开留存源码证据；程序候选通过 RSA-OAEP-SHA256 与 AES-256-GCM 加密，Actions 仅按白名单上传密文及二进制哈希表。不得上传原始 runtime ZIP 或 DLL。完整编译后的打包错误也保留加密恢复材料；`closureValid:false` 的恢复包不是有效运行库，CI 仍报告失败，必须核实全部未解析依赖。
4. 下载密文后，在 `.tmp` 中用 `private-native-artifact.mjs unseal <envelope.json> <candidate.zip> <private.pem>` 解密。错误接收者或被修改的密文会拒绝解密；已有输出不会覆盖。
5. 检查源码材料和实际导入闭包，在隔离资料库完成 H.264/H.265/MKV、声音、暂停、跳转、字幕、重启测试，再决定是否切换当前运行库。切换后必须重新执行桌面打包与正式身份验收。

所有结果保持 `approved:false` 与 `sourceComplianceApproved:false`。CI 成功只证明构建完成及所执行检查通过。原有 `release-approval.json`、运行库锁和公开发行门槛都保持独立。

## 从保存的输入重建

在新的 Linux 构建目录安装证据中记录的工具链版本，然后运行：

```sh
python3 scripts/restore-native-source-inputs.py /path/to/evidence /path/to/new-disposable-tree
sh /path/to/new-disposable-tree/rebuild.sh
```

第一步核验所有源码档案的字节数、SHA-256 和成员路径后才创建新目录；拒绝覆盖已有目录。它恢复 mpv、实际依赖树及已包含的递归子模块，而不是再次解析浮动 Git 分支。构建配方只迁移源码采集器路径，保留当次编译选项。保存的源码证据目录必须一起保留，采集器会验证原档案；不要修改或删除证据来绕过失败。第二步才实际编译，不自动打包或批准发行。

恢复操作本身无需联网。原始配方对已存在的依赖目录跳过下载，Meson 使用 `wrap_mode=nodownload`；仍需在对应 Linux 工具链上验证重编，不能把本机恢复成功写成位级可重复构建通过。

源码下载有超时/重试上限，Git HTTP 慢连接有退出阈值。编译进程最长 90 分钟，之后预留时间上传已经采集的证据；Runner 本身异常中断仍可能无法上传。

未来应用代码更新且原生依赖字节不变时，可复用已审查的源码材料和组件哈希；更新原生依赖时重跑这一构建留存流程，无需重新追查历史构建任务。最终应用 ZIP 仍执行自动完整性检查和与变更相关的人工验收。

## Private player and media package verification

The recovered candidate from run 38134981406 is pinned separately in
`scripts/native-source-player-runtime.lock.json`. It can be staged only from
the exact local ZIP, without changing `native-bin/player-runtime`:

```powershell
$env:MOVIE_PLAYER_VARIANT = 'source-candidate'
$env:MOVIE_SOURCE_PLAYER_ZIP = '.tmp/traceable-player-runtime/candidate-38134981406.zip'
$env:MOVIE_SOURCE_NATIVE_ZIP = $env:MOVIE_SOURCE_PLAYER_ZIP
$env:MOVIE_MEDIA_VARIANT = 'source-candidate'
$env:MOVIE_RELEASE_CLASS = 'unsigned-test-build'
npm run dist:zip
npm run verify:zip
```

Use the repository's locked Node/npm environment. Staging validates the ZIP,
every selected DLL/notice, paths and x64 architecture. The package records the
player variant and lock hash; verification requires the same selection. The
runtime is copied exactly once, preserving all 24 dynamic dependencies. Public
release remains blocked for this experimental selection. Ordinary builds retain
the historical candidate. The source media selection stages only the two
command-line executables and their 12 DLL dependencies into
`.tmp/native-source-media-tools`; it does not overwrite the old media tools.
Both locks refer to the same retained ZIP and source evidence. Package and ZIP
verification require exact media/player lock hashes and every copied file,
including notices. See `NATIVE-SOURCE-CANDIDATE.md` for exact scope.
