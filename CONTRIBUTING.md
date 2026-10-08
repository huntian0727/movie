# 参与开发

目前项目自有代码的许可证仍待维护者确认；提交代码前请先确认授权方式。
仅提交您有权贡献的代码，标明引用来源和第三方许可证；不要把来源不明代码改名后当作原创。
Git 作者信息只能说明提交记录，不能证明著作权归属。

开发使用 Windows x64、Node.js 22.23.1、npm 10.9.8；无 C++ 工具时执行 `npm run install:locked`，详见 [原生模块工作流](docs/native-abi-workflow.md)。CI 另外覆盖普通 `npm ci`。
从最新 `main` 创建独立分支。遵守 [AGENTS.md](AGENTS.md) 和风险分级工作流。
所有文件删除、数据库升级、安装/卸载测试必须使用临时数据，禁止操作真实资料库。

Node 测试 checkout 执行 `npm run test:release-gate`。
打包 checkout 独立执行 `npm run package:dir`、`npm run verify:artifact`、
`npm run test:packaged-smoke`、`npm run dist:win`、`npm run release:metadata`、`npm run test:installer-smoke`。
better-sqlite3 的 Node/Electron ABI 不可混用，参见 [原生模块工作流](docs/native-abi-workflow.md)。
不能删除测试、跳过检查或降低安全断言来制造通过结果。

PR 请描述触发条件、最终行为、验证结果和未执行的实机项目。
UI 截图只使用虚构样本。不要提交数据库、缓存、诊断包、密钥、内部地址、个人路径或真实媒体。
安全报告遵守 [SECURITY.md](SECURITY.md)，不要用公开 PR 传播真实密钥。

仅维护者批准的许可证、二进制授权与签名材料可以解除正式发布门禁。
证书及密码必须配置为 GitHub Secrets；不允许打印 Secret、写入仓库或用测试包冒充签名发行包。

NativeHost采用锁定的官方NuGet编译器及.NET Framework4.8引用，无需Visual Studio；构建机仍需Framework4.8+运行时和访问固定api.nuget.org地址。使用固定Node.js执行 node scripts/test-native-player-reproducibility.mjs 检查两份不同路径的字节一致性。缓存只位于忽略目录.tmp，不进入安装包，来源/许可和升级边界见 [工具链记录](docs/legal/nativehost-toolchain.json)。
