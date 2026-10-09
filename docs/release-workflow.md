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

**重要：目前该工作流的正式发布步骤仍要求签名证书与独立环境审批，尚未实现不签名公众发行通道；不能简单把 `unsigned-test-build`（独立身份/临时数据目录）重新命名成正式包。** 待 FFmpeg 候选许可与安装验证完成后，应独立新增有批准门禁、保留正式 appId/安装目录、跳过 Authenticode 的 `unsigned-public-release`，并使用原 NSIS 删除安全和 QA，最后再上架。任何二进制分发仍需履行第三方许可，免费分享不豁免。
