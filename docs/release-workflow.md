# Windows CI 与发布工作流

本页反映 2026-10-08 的实际工程，具体实测结果见 [发布审计](public-release-audit.md)。历史测试数字不能作为当前版本验收。

PR 的 Windows CI 包含完整 Node release gate、独立 Electron native/security smoke、依赖审计和依赖上述检查的 unsigned x64 NSIS 安装 QA。独立安全工作流以非浅历史、固定版本 Gitleaks、全部 npm 依赖审计扫描 main/PR。Action 固定完整 commit SHA；checkout 不保留推送凭据。

Node 22.23.1 / npm 10.9.8 / Electron 44.7.0 固定，N-API 13.0.3 的实际兼容性须运行验证；无 C++ 环境安装入口详见 [原生模块工作流](native-abi-workflow.md)。普通 npm ci 也在具备 C++ 工具的 CI 中覆盖，不用缓存的 node_modules 冒充完整安装。

测试包始终使用 com.local.video.manager.unsignedtest、独立 NSIS GUID、独立 userData 与文件名，输出 release/unsigned-test-build/。正式 appId 为 com.local.video.manager；两类包不得混用。正式输出 release/signed-release/。旧 release/win-unpacked 与已有用户快捷方式不是本轮更新目标。

完整顺序是 release gate → npm audit → package:dir → actual Electron smoke → verify:artifact → packaged smoke → dist:win → verify:artifact → release:metadata → installer smoke。所有失败必须中止，禁止 continue-on-error 或删减断言。打包内容必须包含 SQLite N-API、FFmpeg、FFprobe、x64 NativeHost、Electron/Chromium 与第三方法律材料。metadata 检查真实 Authenticode 与 SHA-256，不以存在证书环境变量作为签名证据。

NSIS 使用已构建文件清单做精确删除、非递归空目录清理；拒绝 reparse/junction、未知未标记安装目录、旧未经审查卸载器与 --delete-app-data。临时 smoke 覆盖首次安装、同包修复、卸载、安装目录内外 SQLite/视频/嵌套哨兵，以及生产注册表和快捷方式不变。同包修复不是上一正式签名版升级。

公开仓库的 unsigned QA 工作流仅上传无二进制的 build-metadata.json、build-flavor.json、SHA256SUMS.txt。未闭环的 GPL 对应源码义务同样适用于测试包，unsigned 标签不能豁免。完整本地候选只供维护者审查，不应公开传播。

正式 tag 的签名 job 受 public-release environment 审查保护。还必须通过 build/release-approval.json 的 owner 权属/许可证、lockfile 与二进制输入哈希、对应源码材料、真实干净 Windows 11 和历史签名升级证据。默认 approved=false；环境变量不能替代证据。签名证书只在 GitHub Secrets WINDOWS_CSC_LINK / WINDOWS_CSC_KEY_PASSWORD 中配置，只传入实际签名步骤，不进入安装依赖、日志、smoke 或上传环境。

正式 job 验证应用、NativeHost、安装器的有效发布者及时间戳，并再次核对 installer SHA-256 后才上传 Release。不得重新签名第三方 FFmpeg 以改变来源证明。本轮没有推正式版本 tag、触发发布 dispatch 或创建公开 Release；仅提交审核分支与 PR。

正式job还必须实时核对public-release环境：required reviewers、prevent self-review、禁止管理员绕过、唯一v* tag部署策略。本轮只读API返回404，配置尚未确认；不能仅凭YAML声明environment就认为已受人工批准保护。

干净 Windows 11/no-Node、物理卷/SMB/ACL/磁盘满、实际历史签名版升级与人工 UI 验收仍需独立完成，见 [验收工具包](clean-windows11-acceptance.md) 和 [普通用户安装教程](windows-installation.md)。

## 2026-10-09 免费分享发行策略变更

项目自有代码已选定 MIT（见根目录 LICENSE）；维护者不计划商业化，也**不购买首个公众版本的 Windows 代码签名证书**。这意味着正式发行时，安装包可以在签名状态为 `NotSigned` 的情况下发布，但必须明确告知用户“未知发布者”和 SmartScreen 提示，公布 SHA-256，并继续保护下载渠道、保留安装/卸载的数据安全验收。

**更新（2026-10-10）：** 已新增仅手工触发的 `windows-community-candidate.yml`，用于**获批准后生成私有未签名社区候选包**。它不调用 GitHub Release、不能被 tag push 自动触发、不会上架给公众；只允许与 `package.json` 相同的 `v<版本>` tag、明确的维护者确认、仓库的三项批准变量和含真实法律/干净 Win11 证据的 `build/release-approval.json` 同时满足时构建。普通 `unsigned-test-build` 仍绝不能改名替代。实际公开发布还需在独立审查所有对应源码和附件后人工实施，免费分享不豁免第三方许可证。

## 2026-10-09 未签名公众分享通道：代码已预置，严格关闭

新增独立的 `unsigned-public-release` **构建身份**：应用 ID `com.local.video.manager.community`，NSIS GUID `b73f7252-798d-48d9-b877-19fb6d355f83`，程序名 `拉面影视-免费分享版`，数据目录 `local-video-manager-community`，目标目录 `release/unsigned-public-release`；与原 `signed-release` 和独立 `unsigned-test-build` 均不同。不是正式旧版升级通道，避免把历史旧版和维护者日常安装当成可直接覆盖的用户数据。NSIS 仍使用精确清单删除，拒绝未标记旧目录、重解析点与删除数据参数。

现在 GitHub `v*` tag 会运行无二进制发布权限的隔离 QA，但签名正式 job **必须额外显式配置仓库变量 `MOVIE_RELEASE_CHANNEL=signed` 才启动**；未签名社区候选 job 仅 `workflow_dispatch` 手工触发，不随 tag 自动运行。只有显式提供 `MOVIE_RELEASE_CLASS=unsigned-public-release`、`MOVIE_MEDIA_VARIANT=lite-candidate`、真实匹配版本 `refs/tags/v<版本>`、GitHub Actions 环境、`RELEASE_LICENSE_APPROVED=true`、`RELEASE_BINARY_COMPLIANCE_APPROVED=true`、`RELEASE_MANUAL_QA_APPROVED=true`、`RELEASE_UNSIGNED_PUBLIC_ACKNOWLEDGED=true` 且**不提供任何代码签名密钥**才会允许进入构建配置。随后 `verifyFormalApproval` 还必须逐字节验证 `build/release-approval.json` 的 owner、LICENSE、lockfile、FFmpeg/FFprobe、NativeHost、**5 个原生运行时 DLL**、各自来源证据哈希及真实干净 Windows 11 证据。因为完全独立的 `community` 安装身份不尝试覆盖已签名旧版，允许不提供历史原版直接升级测试，但依然强制干净 Windows QA。

安装器本身预定为 **NotSigned** 并带单独 SHA-256，不购买证书；安装教程需明确 SmartScreen、未知发布者、官方 GitHub 地址。**本轮 `build/release-approval.json` 仍全部拒绝，尚无允许公众下载的二进制**。GitHub 不设置任何自动上传公众安装包的 job；新增的社区候选 workflow 即使审核通过，也只保存 SHA256/构建元数据/SBOM 作为 Actions Artifact（不上传 exe 或任何第三方二进制）。真正发布必须在手工 QA 和对应源代码材料实际可获得、维护者最终批准后单独执行。
