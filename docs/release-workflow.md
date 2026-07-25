# Windows CI 与发布工作流

## Pull Request 门禁

`.github/workflows/windows-ci.yml` 在 `windows-latest` 和固定 Node/npm 下运行三个独立 job：

- `Node tests and Windows file safety`：安装、lint、build、Windows 文件操作回归和完整 Node 测试。
- `Electron native and main-process smoke`：独立 checkout，重建 Electron ABI，并验证真实主进程与临时 SQLite。
- `Dependency review`：只在 PR 上检查 lockfile 引入的依赖风险。

建议在 GitHub 默认分支规则中要求以上三个 check，并要求分支与 `main` 保持最新。2026-07-25 本地固定环境的完整 Node 测试为 258/258；GitHub checks 仍需首次推送后实际通过，不能用 `continue-on-error` 或删减门禁替代。

Node job 统一调用 `npm run test:release-gate`。该入口依次执行 lint、build、Windows 文件安全矩阵、全部历史迁移、性能基线和完整 Node 测试，避免 release workflow 只打包却跳过数据安全回归。真实物理卷、ACL、独占文件锁和 SMB 断线仍须使用 [Windows 发布数据安全验收单](windows-release-checklist.md) 签字。

仓库管理员在 workflow 首次推送并产生 check 后，再配置 branch protection；在此之前提前要求不存在的 check 会锁死合并。建议规则：至少一名审查者、禁止 force push、要求 conversation resolved、要求上述 checks、管理员同样受规则约束。

## 手工测试构建

从 Actions 手动运行 `Windows Release`。未配置签名 secrets 时，产物元数据明确写为 `unsigned-test-build`，artifact 名称也包含 `unsigned-test-build`，不能作为正式发布。

本地或手动 CI 在没有 `CSC_LINK`/`WIN_CSC_LINK` 时，会明确关闭 Windows 可执行文件签名与资源编辑。这既避免把 unsigned 产物伪装成正式版本，也使没有“创建符号链接”权限的普通 Windows 开发机无需解包签名工具。只要配置了签名证书，构建脚本就不会应用该豁免，正式 tag 仍执行完整签名。

工作流会依次执行：

1. `test:release-gate` 完成 Node 数据安全、迁移和性能回归。
2. `npm audit --omit=dev` 检查生产依赖；未处置的审计失败会阻断发布。
3. `package:dir` 生成 `release/win-unpacked`。
4. 检查 asar 不包含 `.env`、测试、SQLite、`.dbg` 或本机工作区路径。
5. 对 unpacked 应用执行两阶段 packaged smoke。
6. `dist:win` 生成真正的 NSIS installer。
7. 生成 `SHA256SUMS.txt` 和 `build-metadata.json`。
8. 静默首次安装后再次运行同一安装包，覆盖 NSIS 升级/修复路径；随后运行 packaged smoke。
9. 静默卸载，并确认沙箱用户数据库与源视频哨兵内容未变化。
10. 上传 installer、校验和及构建元数据。

## 正式 tag 发布与签名

GitHub Secrets 名称：

- `WINDOWS_CSC_LINK`：代码签名证书内容或 electron-builder 支持的安全引用。
- `WINDOWS_CSC_KEY_PASSWORD`：证书密码。

推送 `v*` tag 时，如果任一 secret 缺失，发布 job 会立即失败。签名、installer smoke 和元数据成功后，workflow 才创建 GitHub Release。证书、密码和解码后的私钥不得写入仓库、日志或 artifact。

## Packaged smoke 覆盖

第一次进程启动验证：

- `app.isPackaged`；
- preload bridge 已加载；
- `better-sqlite3` 建库和 `quick_check`；
- ffmpeg/ffprobe 静态可执行文件可访问；
- 自定义媒体协议已注册；
- 临时目录中的小视频 fixture 被扫描入库。

第一次进程退出后，第二次进程使用相同临时 userData 重新打开数据库，并确认记录仍存在。所有 smoke 数据都位于系统临时目录，不接触真实用户资料库或视频。

installer smoke 的“升级”是同一候选安装包的重复安装，只验证 NSIS repair/overwrite 基线。正式发布仍必须拿上一正式签名版本执行真实跨版本升级，并在发布验收单记录证据。
