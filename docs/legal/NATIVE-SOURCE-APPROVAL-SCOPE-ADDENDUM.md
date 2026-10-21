# 原生源码发行审批范围补充说明

更新时间：2026-10-21（Asia/Shanghai）

本文件是当前状态补充说明，不修改历史审批 JSON、不替代任何所有者批准，也不把旧批准转移到新候选。

## 已存在的旧批次批准

当前 `build/native-source-approval.json` 的 `approved` 为 `true`，其文件 SHA-256 为 `f8e30e3aa1bee0aa47b3a5c28c7b7f76db7fa8e1f2b99648573f8ee67ec46311`。它精确绑定以下旧批次：

- 生产构建 run：`38134981406`；构建 commit：`dac070da604a12acb2eeedccb4993f1ebc52e001`。
- 媒体锁 SHA-256：`70ab4dac7dfe6c433f26802861f5e1f3b76dcd8997cd2cd313e209a9f2e17fa5`。
- 播放器锁 SHA-256：`11ad832489dabf095b9d06bb0c6011e8144905a5eeac25d69b24c2f76aac532f`。
- 原生 ZIP SHA-256：`3b4b4d22a3cf303b05898dedd470a6f05b0bfaa532c4ca9ab481167cd8f21b99`。
- 对应源码/工具链证据 ZIP SHA-256：`3e242199da78c68939ebcbc8bb70bae4c2e57102b7aadc5ceb6b54317880e70a`，255,050,585 字节。

该旧批次的生产 CI 仍真实记录为 `FAIL`，原始 `binary-source-map.json` 的 `closureValid:false` 保持不变；后来对实际 PE 导入和 Microsoft 系统 DLL 的本机核验是独立证据，不应改写为“原生产 CI 通过”。旧批准仅对上述精确哈希及审阅材料有效。

另外，`build/public-test-approval.json` 的批准范围是 `0.1.15-beta.3`；`build/release-approval.json` 的批准范围是 `0.1.15`。后者的 `stableWindowsCoverage` 和 `standardUserCoverage` 均为 `false`，原生二进制记录仍未填入精确哈希。这些旧版本批准不等于 0.1.16 获准发行。

## 0.1.16 新候选验证

2026-10-21 启动了新的私有原生构建 run：`39598671777`，目标 commit `757348117960dc2e184a9c1ad5facbeca2cf2d0f`。该 run 已结束且为 `FAIL`。失败点不是前一轮 Windows 系统导入分类，而是 MPV 编译时 FFmpeg `AVStream.nb_streams` / `AVStream.streams` 的弃用警告被 `-Werror=deprecated-declarations` 提升为错误；编译中止后，上游 shell 配方没有传播 `meson compile` 的失败状态，打包脚本继续尝试复制不存在的 `libmpv-2.dll`，造成后续错误。

无论该构建是否通过，新的二进制/源码哈希都不会自动继承旧批次批准。当前 `scripts/native-source-media.lock.json` 和 `scripts/native-source-player-runtime.lock.json` 以及两个批准 JSON 均须保留原样，直到新候选完成独立审阅并由所有者明确批准。不得为了通过门禁手动翻转 `approved`、`sourceComplianceApproved`、`distributable` 或哈希字段。
本地未推送修复位于 `scripts/native-source-build.py`：只给 MPV 构建阶段的 `CFLAGS` 增加 `-Wno-error=deprecated-declarations`，不关闭全局 `werror`；同时要求 `meson compile` 失败立即退出，避免误入打包步骤。已用固定上游配方 SHA-256 `22a98842b121a8a947b1703251bd72b4f553ff4fd91a5894202af156539a3ea2` 验证补丁输入匹配，且验证生成配方同时包含定向警告处理与失败状态传播。`npm run test:native-source-build` 本地通过（13 + 10 + 6 = 29 项）。这只是本地脚本/契约验证；修改尚未由新的 GitHub Actions 构建验证，也没有新的原生二进制。下一步需在获准推送后运行新的私有构建，再核对构建结论、`closureValid`、`unresolvedImports`、候选 ZIP 哈希与源码证据哈希。
