# Node / Electron Native ABI 工作流

`better-sqlite3` 是原生模块。同一个 `better_sqlite3.node` 不能同时服务 Node/Vitest 与 Electron；ABI 不匹配是依赖产物问题，不是用户数据库损坏，禁止通过删除 `library.sqlite` 处理。

## 固定版本

- Node：22.23.1 LTS
- npm：10.9.8（Node 22.23.1 官方源码标签内置版本）
- Electron：由 `package-lock.json` 固定；当前解析为 33.4.11，native ABI 130

版本来源：[Node 22.23.1 官方发布页](https://nodejs.org/en/blog/release/v22.23.1)、[该版本内置 npm package.json](https://raw.githubusercontent.com/nodejs/node/v22.23.1/deps/npm/package.json)。升级 Node 或 npm 时必须同时修改 `package.json`、lockfile、`.nvmrc`、`.node-version`、Volta 配置、环境检查测试和 CI cache key。

## Node 测试 checkout

```bash
node --version
npm --version
npm ci
npm run verify:native:node
npm run test:node
npm run lint
npm run build
```

期望版本分别为 `v22.23.1` 和 `10.9.8`。`preinstall` 会在不匹配时提前失败。`verify:native:node` 创建临时 SQLite，完成建表、写入、查询和关闭；不接触用户数据。

此 checkout 不运行 `rebuild:electron`。若 Node smoke 报 ABI 错误，在这个 Node 专用 checkout 中重新执行干净 `npm ci`；不要随后拿它启动 Electron。

## Electron 开发 checkout

```bash
npm ci
npm run prepare:electron
npm run test:electron-smoke
npm run dev:electron
```

`prepare:electron` 显式重建 `better-sqlite3` 并立即运行 Electron smoke。smoke 启动真实 Electron 主进程，等待 `app.whenReady()`，再用 Electron ABI 创建临时 SQLite 并读写。转换后此 checkout 只用于 Electron 启动/打包，不再运行 Node Vitest。

如果 rebuild 报 `EPERM unlink better_sqlite3.node`，关闭应用、Electron 开发窗口、Vitest watch，以及所有可能加载该 `.node` 的 Node/Electron 进程后重试。脚本不会删除或建议删除用户数据库。

## Packaged app

packaged app 使用 Electron ABI，但必须在独立 release checkout/job 中由 electron-builder 重建，不能复用 Node 测试 cache，也不能把开发 checkout 中偶然存在的 `.node` 当作发布证据。packaged smoke 和安装包门禁属于 T06。

## CI 与缓存隔离

Node tests、Electron smoke、packaged build 必须是独立 checkout/job。建议 cache key 至少包含：

```text
<os>-node-22.23.1-npm-10.9.8-<lockfile-hash>-abi-node
<os>-node-22.23.1-npm-10.9.8-electron-33.4.11-<lockfile-hash>-abi-electron
<os>-node-22.23.1-npm-10.9.8-electron-33.4.11-<lockfile-hash>-abi-packaged
```

不得在三个 job 间缓存或传递完整 `node_modules`。可以缓存 npm 下载缓存，但 key 中仍需包含 OS、Node、npm、Electron、lockfile hash 和 ABI 目标。

## 诊断顺序

1. 运行 `npm run verify:environment`，先排除 Node/npm 版本错误。
2. 确认当前 checkout 的用途是 Node、Electron 还是 packaged。
3. 运行对应 `verify:native:*` smoke，记录 runtime ABI 和 Electron 版本。
4. Node checkout 用干净 `npm ci` 恢复；Electron checkout 关闭占用进程后用 `npm run rebuild:electron` 恢复。
5. 仍失败时保留完整命令输出、Node/npm/Electron 版本和 `.node` 占用进程信息；不要触碰视频文件或用户数据库。
