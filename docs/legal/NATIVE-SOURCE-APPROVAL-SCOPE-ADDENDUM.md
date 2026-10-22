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

2026-10-21 的 run `39598671777` 因 MPV 编译时 FFmpeg `AVStream.nb_streams` / `AVStream.streams` 弃用警告被 `-Werror=deprecated-declarations` 提升为错误而失败；上游 shell 配方还未传播 `meson compile` 的失败状态，随后打包器尝试复制未生成的 `libmpv-2.dll`。在 commit `3b73062` 中已做定向修复：只对该类弃用警告取消“视为错误”，并让 Meson 编译失败立即退出；`npm run test:native-source-build` 的专项测试 29/29 通过。

修复后的私有构建 run `39612312642`（commit `3b73062e7008a34c8d1dba78bf09d6edb5ff3666`）已 SUCCESS。新 runtime ZIP SHA-256 为 `46b7a00a9275da307efc89e320ef0c5c87a846fd020e5d1167f838a0d394447a`（39,836,889 字节），对应源码候选 ZIP SHA-256 为 `4325dc1a0d216ff89785337ab68833b0a5f6f35fcfd9795370802e1c6c621130`（254,553,043 字节）；当前候选的完整 PE import closure 已验证。该成功记录不改写 run `38134981406` 的历史 FAIL，也不自动批准新候选。

当前锁文件 `scripts/native-source-media.lock.json` 与 `scripts/native-source-player-runtime.lock.json` 仍为 `CANDIDATE_NOT_APPROVED` / `distributable=false`。它们的锁哈希分别为 `2371799a58b3ecad5d5b493dd82de8aa5378b607be86f1fa3bc70f7f9c6a8d28` 和 `c00527fa8794f331f25d11e7199a3ed7ab298a848a2cb394473ec72d56af206e`；当前 `build/native-source-approval.json` 仍绑定旧锁哈希 `70ab4dac7dfe6c433f26802861f5e1f3b76dcd8997cd2cd313e209a9f2e17fa5` / `11ad832489dabf095b9d06bb0c6011e8144905a5eeac25d69b24c2f76aac532f` 和旧源码证据 ZIP `3e242199da78c68939ebcbc8bb70bae4c2e57102b7aadc5ceb6b54317880e70a`。`.tmp/native-run-39612312642/compiled-source-license-review.json` 仍是 `approved=false` / `sourceComplianceApproved=false`，并引用旧 producer run `38134981406`，因此它不能作为新候选的许可批准。

下一步必须以 run `39612312642` 的实际二进制、对应源码归档、编译日志与依赖通知为对象完成独立审查，更新新的候选审查证据并由所有者明确批准；同时保留旧审批记录不变。禁止手动翻转 `approved`、`sourceComplianceApproved`、`distributable` 或哈希字段来绕过发行门禁。