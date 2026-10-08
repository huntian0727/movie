# Windows 发行工程与隔离测试

正式产品名称仍为 **拉面影视**，正式 appId 仍为 `com.local.video.manager`，正式数据目录仍为 `%APPDATA%\local-video-manager`。版本来自 `package.json`，不使用另外一份手写版本。发行脚本从当前已安装的 Electron 读取版本，固定 Windows x64 输出。

## 测试产物与真实资料隔离

无签名凭据时构建 `unsigned-test-build`，程序和安装包文件名均含该标记。测试 appId 是 `com.local.video.manager.unsignedtest`，NSIS GUID、包名称、默认安装目录、updater 缓存和数据目录都与正式产品分开；不创建生产快捷方式或文件关联。

- 测试 unpacked：`release/unsigned-test-build/win-unpacked/拉面影视-unsigned-test-build.exe`。
- 测试 installer：`release/unsigned-test-build/拉面影视-<版本>-x64-unsigned-test-build-Setup.exe`。
- 测试默认数据目录：`%APPDATA%\local-video-manager-unsigned-test`。
- 签名候选目录：`release/signed-release/`。

构建不会覆盖此前 `release/win-unpacked` 和真实用户的桌面快捷方式。`resources/build-flavor.json` 记录类型、身份、架构、版本和构建基准 commit。未提交代码必须在交付说明中披露，不能仅凭 commit 字段宣称完全可复现。

## NSIS 数据保护

保留 electron-builder + NSIS。辅助安装界面只允许当前用户；隐藏任意安装目录选择。命令行最终目标也会校验：初始化、`.onVerifyInstDir` 和内置安装 Section 前的隐藏安全 Section 都会检查最终路径、reparse 点、普通文件占用和安全标记。非空且无合法安全标记的目录会被拒绝。

卸载仅删除从本次 packaged regular files 生成的白名单文件，再以不带 `/r` 的 `RMDir` 删除空目录。不会扫描安装目录并把未知文件列为删除对象；安装目录中的未知视频、SQLite 和其他文件保持原位。显式 `--delete-app-data` 也会拒绝。

新安装器无法改变已注册旧版卸载器的递归行为。因此缺少新安全标记的历史安装会在调用旧卸载器前阻断，需要独立审核迁移方案。**同一个 unsigned 候选反复安装只证明该安全候选的 repair 路径，不能宣称上一正式版本升级通过。** 文件占用 preflight 不是事务：仍不能宣称机器断电、文件在检查后被替换、磁盘满等情况下安装回滚已经验证。

`test:installer-smoke` 只接受当前版本、当前 SHA-256、实际 unsigned 签名状态和固定隔离身份的候选。首次安装到非空临时用户目录必须失败且视频/真实 SQLite 哈希不变；随后在新的临时目录安装、重复安装和卸载。有效合成视频和真实 SQLite 哨兵位于临时 profile、安装目录外、安装目录内及 resources 的未知子目录。每步比较哈希并执行 SQLite quick_check，确认生产注册信息/快捷方式摘要不变。测试失败保留临时诊断，不递归删除任意真实目录。

这不代替干净 Windows 11 无 Node.js 电脑、真实上一签名版本、真实硬件/SMB/ACL/断电等发布验收。

## 实际签名与 SHA-256

`release:metadata` 只处理 build-flavor 指向的当前版本安装包，不混入旧目录中的其他 Setup 文件。实际执行 Windows `Get-AuthenticodeSignature`：测试包必须 `NotSigned`；正式 installer、应用和自有 NativeHost.exe 必须 `Valid`、有 timestamp 且符合批准的 publisher。缺少真实签名能力时失败，不以证书环境变量替代签名证据。输出 `SHA256SUMS.txt`、`build-metadata.json` 和各自可执行文件的 SHA-256。

正式构建必须在 GitHub Actions，签名凭据只来自 GitHub Secrets。证书内容和密码仅注入签名构建步骤，不提供给 `npm ci`/第三方 postinstall、元数据检查或上传步骤。第三方 FFmpeg/FFprobe 不重新签名，以保留批准的二进制字节；NativeHost 作为自有可执行文件签名。发行工具不会把证书内容/密码写入 JSON 或日志。

## 正式门禁与集中待决事项

`build/release-approval.json` 默认全部 `false`，未授予许可证。正式构建除 GitHub approval variables 外，还核对仓库审批记录：

- 权属确认、实际选定的 LICENSE grant 和 LICENSE 文件 SHA-256；占位 LICENSE 不可通过。
- package-lock SHA-256；实际 FFmpeg/FFprobe/NativeHost 输入哈希。
- 每个二进制的确切源码/构建/许可合规证据文件及 SHA-256。
- 干净 Windows 11 无 Node 和上一正式签名版本升级的证据文件及 SHA-256。
- 发布类型、版本/Tag 对齐、expected publisher、真实 Authenticode 验证。

模板的 null/false 是未批准，不能为了生成正式包改成 true。许可证、权属、完整 GPL 对应源码、证书与历史升级策略由所有者审核决定。NativeHost 使用锁定的官方 NuGet Roslyn 编译器、六份 .NET Framework 4.8 引用和 deterministic/pathmap 参数，每次构建复核所有输入字节，拒绝重解析路径、篡改和额外缓存文件。可用固定 Node.js 执行 node scripts/test-native-player-reproducibility.mjs 验证两份不同绝对路径构建逐字节相等；本轮实测通过。工具许可/来源和独立漏洞信息见 [NativeHost工具链](legal/nativehost-toolchain.json)。正式批准仍绑定确切输入hash；跨Windows2025机器复现尚未验证，编译工具缓存不分发。

GitHub Actions 先执行无签名隔离 QA，再由受保护 `public-release` environment 审核正式签名候选。Actions 固定 commit SHA，checkout 不保留 Git 凭据；正式上传前重新核对安装包 SHA-256。本次工作不执行 workflow dispatch，不推送版本 Tag，不创建公开 Release。
