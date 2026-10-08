# Node / Electron Native ABI 工作流

`better-sqlite3` 13.0.3 使用 N-API；官方 npm 包的 `prebuilds/win32-x64.node` 已在 Node 22.23.1 和 Electron 44.7.0 中实际读写 SQLite。旧版 11 的 `build/Release/better_sqlite3.node` 有不同 ABI，不能复用。原生模块加载错误不代表用户数据库损坏，禁止删除 `library.sqlite` 来修复。

## 固定版本

- Node：22.23.1 LTS
- npm：10.9.8（Node 22.23.1 官方源码标签内置版本）
- Electron：由 `package-lock.json` 固定；当前解析为 44.7.0，native ABI 由真实 Electron smoke 报告，不沿用旧 ABI 130。

版本来源：[Node 22.23.1 官方发布页](https://nodejs.org/en/blog/release/v22.23.1)、[该版本内置 npm package.json](https://raw.githubusercontent.com/nodejs/node/v22.23.1/deps/npm/package.json)。升级 Node 或 npm 时必须同时修改 `package.json`、lockfile、`.nvmrc`、`.node-version`、Volta 配置、环境检查测试和 CI cache key。

## Node 测试 checkout

```bash
node --version
npm --version
npm run install:locked
npm run verify:native:node
npm run test:node
npm run lint
npm run build
```

期望版本分别为 `v22.23.1` 和 `10.9.8`。`preinstall` 会在不匹配时提前失败。`verify:native:node` 创建临时 SQLite，完成建表、写入、查询和关闭；不接触用户数据。

固定 npm 10.9.8 存在 [lockfile 丢失 gypfile:false 的缺陷](https://github.com/npm/cli/issues/9837)。`install:locked` 校验环境后以 `npm ci --ignore-scripts --include=dev` 提取完整依赖，再对有真实安装脚本或未退出 gyp 的确切包目录执行 `npm rebuild --ignore-scripts=false`，重放根项目生命周期并运行 Node native gate。它没有修改第三方源码或跳过 authored install 脚本。普通 `npm ci` 在具备 C++ 工具的 CI 中另行验证。

## Electron 开发 checkout

```bash
npm run install:locked
npm run prepare:electron
npm run test:electron-smoke
npm run dev:electron
```

`prepare:electron` 对当前固定的 N-API 13.0.3 直接启动真实 Electron，等待 `app.whenReady()` 后创建临时 SQLite 并读写，且检查完成标记。其他版本仍走显式 rebuild 并立即验证。不得把“存在一个 .node 文件”当作兼容性通过。

如果 rebuild 报 `EPERM unlink better_sqlite3.node`，关闭应用、Electron 开发窗口、Vitest watch，以及所有可能加载该 `.node` 的 Node/Electron 进程后重试。脚本不会删除或建议删除用户数据库。

## Packaged app

packaged app 必须在独立 release checkout/job 中安装锁定依赖并执行真实原生运行门禁。制品审计校验 x64 PE 架构及官方 N-API 输入与安装包副本的 SHA-256 一致性，随后 packaged smoke 再验证 SQLite。不能复用旧版本 binding。

## CI 与缓存隔离

Node tests、Electron smoke、packaged build 必须是独立 checkout/job。建议 cache key 至少包含：

```text
<os>-node-22.23.1-npm-10.9.8-<lockfile-hash>-abi-node
<os>-node-22.23.1-npm-10.9.8-electron-44.7.0-<lockfile-hash>-abi-electron
<os>-node-22.23.1-npm-10.9.8-electron-44.7.0-<lockfile-hash>-abi-packaged
```

不得在三个 job 间缓存或传递完整 `node_modules`。可以缓存 npm 下载缓存，但 key 中仍需包含 OS、Node、npm、Electron、lockfile hash 和 ABI 目标。

## 诊断顺序

1. 运行 `npm run verify:environment`，先排除 Node/npm 版本错误。
2. 确认当前 checkout 的用途是 Node、Electron 还是 packaged。
3. 运行对应 `verify:native:*` smoke，记录 runtime ABI 和 Electron 版本。
4. Node checkout 用干净 `npm ci` 恢复；Electron checkout 关闭占用进程后用 `npm run rebuild:electron` 恢复。
5. 仍失败时保留完整命令输出、Node/npm/Electron 版本和 `.node` 占用进程信息；不要触碰视频文件或用户数据库。
