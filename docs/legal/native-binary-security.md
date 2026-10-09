# 原生媒体二进制的安全审查

查询日期：2026-10-08，Asia/Shanghai。这是已测二进制版本与上游修复记录的对照，不能被 npm audit 的零项结果替代。

| 输入及实际位置 | 实测版本 | 上游证据及判断 |
| --- | --- | --- |
| ffmpeg-static/ffmpeg.exe；src/main/media/cacheService.ts:19 | FFmpeg 6.1.1 | 官方6.1.2列出CVE-2024-7055等修复，6.1.3还有后续修复。当前版本落后；未取得完整对应源码及补丁证明，不能声称已覆盖这些修复。 |
| ffprobe-static/bin/win32/x64/ffprobe.exe；src/main/media/metadataService.ts:50 | FFprobe 4.0.2 | 官方4.0.3列出CVE-2018-15822，4.0.4/4.0.5还有后续修复。旧构建来源已停止维护，不能仅凭wrapper版本断言二进制安全。 |

来源：[FFmpeg官方安全记录](https://ffmpeg.org/security.html)。以上属于版本和补丁证据的风险判断，没有在本候选上运行恶意媒体POC，不能称这些CVE均已复现、均适用当前配置或已证明可利用。编解码库/静态依赖的完整适用性仍需结合确切源码、启用配置和补丁逐项确认。

**P1：公众发布阻断。** 应将FFmpeg和FFprobe替换为同一套经审查、仍维护的构建输入，同时锁定下载来源、字节hash、启用库、完整对应源码及许可材料；或提交可验证的安全补丁证明。替换后重跑元数据/封面/时间轴、不同格式、原生打包、packaged及installer gates，再更新确切二进制批准hash。不得靠提高npm wrapper版本、增加allowlist或降低hash门禁放行。

本轮候选只以任务生成的合成媒体做安装和工程验收，未获批准向公众分发。项目许可证、GPL对应源码和发布者授权仍由维护者审查；替换来源及其分发材料应与这些决策一并闭环。

## 2026-10-08 接手后的替代构建实测（候选，未接入发布包）

从 `BtbN/FFmpeg-Builds` 精确标签 `autobuild-2026-10-05-13-07` 下载 Windows x64 LGPL static 9.0 系列同套 `ffmpeg-n9.0.2-22-g46d8f462ee-win64-lgpl-9.0.zip`，锁定构建仓库提交 `9acad4a9ef1583096af7836cc1e9c8cbcb4d3950`，官方 GitHub Release asset SHA-256 `1c73d2256f0198805daf0f765feab8d3f21d3ab85e8dda0c2bb44ce1e3a126c7` 与本机下载文件一致。精确 URL 及校验见 `scripts/native-media-candidate.lock.json`。

| 候选文件 | 实测 SHA-256 | 实测版本 |
| --- | --- | --- |
| ffmpeg.exe | `5054ceae23d3d3bb1938c337838333be0a444305a3d89d53e184a9366a49edc9` | `n9.0.2-22-g46d8f462ee-20261005` |
| ffprobe.exe | `2e9e184daf8a35da5ef0d8508ae8d9a0ba482896b1a03f06e03f458dc2266be5` | `n9.0.2-22-g46d8f462ee-20261005` |

两者报告的编译配置一致，未启用 `--enable-gpl` / `--enable-nonfree`；两份 EXE 经 PE x64 校验并归档 `-version` / `-buildconf` / `-L`。合成 MP4、probe JSON、封面 JPG、时间轴 JPG 实测 PASS；5 项候选校验单测通过。原生候选实物与证据仅在家用机隔离 `D:/CodexReleaseAudit/media-candidate-20261008`；没有覆盖 npm 二进制、现行安装器或用户资料。候选审计命令：`node scripts/verify-native-media-candidate.mjs --candidate-directory <隔离目录>`。

**P1 仍未解除：** 这是来源锁定与媒体契约验证，绝非已取得所有外部启用库的完整对应源码、patch、build scripts、每项许可证/通知或可复现编译证明。既有 ffmpeg-static GPL JavaScript 包装层仍在运行包内。需要完成上述完整 GPL/LGPL 合规链、去除或处理 wrapper 授权、正式接入及打包/安装全回归后，再由权利人批准；当前 public release FAIL。

## 2026-10-09 旧 npm 包装层移除和原生工具整合

**当前工作分支的新代码**已经从 `package.json`、锁文件及打包结果中移除 `ffmpeg-static` / `ffprobe-static` 两个旧包，以 `native-bin/media-tools` 内的同套 BtbN Windows x64 LGPL v3 工具直接生成 `resources/media-tools`。主进程不再用 npm 包装层查找/执行 EXE，也不回退 PATH。已完成实际 Windows x64 打包/安装安全 smoke；单独 QA 包仍标记 unsigned-test-build。

新测试版运行输入为 FFmpeg **9.0.2-22** 与 FFprobe **9.0.2-22**，哈希见 `scripts/native-media-candidate.lock.json`。已固定同一发布包、提取构建仓库源码与 FFmpeg 主源码精确 commit、归档输入 SHA，并在 `docs/legal/ffmpeg-source-candidate-inventory.json` 列出 43 个启用的额外库及全部 43 项候选 recipe 路径（具体源码和许可尚待核验）。仅完成主源码与 build-recipe 的归档，**尚未取得全部 43 个外部库的对应版本、源代码、补丁、完整许可证和可重建证明**。原 npm GPL JavaScript 包装层风险已消除，原生 LGPLv3 静态构建的完整许可证、适用的静态链接再链接义务与安全补丁适用性仍属 P1 发布阻断。详情见 [原生构建来源审计](FFMPEG-SOURCE-CANDIDATE.md)；不得把本段作为正式分发许可。
