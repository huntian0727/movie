# 发布授权与第三方材料

审查日期：2026-10-08（Asia/Shanghai）。许可证决定尚未批准。

## 项目自有代码

Git 作者身份、AI 交付记录和仓库公开可见不构成授权证明。
维护者需确认所有历史贡献、图标/截图、NativeHost C# 源码及引用代码的来源和授权。
建议比较 MIT（简短、宽松复用）和 Apache-2.0（明确专利授权和相关终止条款）；
最终选择由权利人决定。根目录 LICENSE 当前只是待决占位，不授予权利。
参考 [MIT](https://choosealicense.com/licenses/mit/) 与 [Apache-2.0 原文](https://www.apache.org/licenses/LICENSE-2.0)。

## 依赖清单

`node scripts/audit-dependency-licenses.mjs` 从锁文件和安装目录生成
`dependency-inventory.json`，记录每个依赖版本、完整性、声明的 SPDX、可找到的许可证文本校验值，
以及真正要分发的 FFmpeg/FFprobe 版本、构建参数和 SHA-256。
这份清单包含开发依赖；声明缺失、复合许可证、MPL/GPL 组件须逐项审查，不能只看顶层 package.json。
当前 428 个锁定包中 75 个属于生产依赖。parse-cache-control 的 package 声明缺失，但实际 LICENSE 经审查为 BSD-3-Clause。
两个旧代理依赖从准确版本的官方 README 补齐 MIT 通知，type-fest 按其 OR 许可选用随包 MIT 文本。
生产包通知文本目前已全部收集，开发侧包含 Python-2.0/MPL-2.0 组件，清单保留其声明和可用文本校验值。
ffmpeg-static 的 JavaScript 包装层本身也声明 GPL-3.0-or-later；整体程序分发方式需审查，不能只以“子进程调用”忽略包装代码授权。

## FFmpeg / FFprobe

实际 FFmpeg 6.1.1 和 FFprobe 4.0.2 均启用 GPL。
npm 包装层的许可证不能代替实际二进制授权。
参考 [FFmpeg 官方许可说明](https://ffmpeg.org/legal.html)。
当前缺少与这两个二进制准确匹配的对应源码、外部库源码、构建脚本/补丁、完整许可证和通知材料。
只链接 FFmpeg 最新仓库或下载一个同版本上游 tarball 不能证明满足当前构建的全部要求。
因此当前不得公开分发安装包；本机隔离测试包仅供工程验收。

批准前必须归档：每个 EXE 的来源 URL、下载校验、`-version`/`-buildconf`/`-L`、
对应源码及所有启用库的许可证/源码、补丁和可复现构建步骤。
也可以选择有完整来源与许可链的替代构建，然后重新运行媒体格式/字幕/封面/时间轴及安装回归。
不能因项目选 MIT/Apache-2.0 而移除第三方 GPL 通知。

NativeHost.exe 来自仓库 C# 编译输出；内嵌播放仍需用户单独提供 libmpv，当前不随包分发。
如果将来包含 libmpv，须重新审查其具体构建及编解码依赖授权。

## 正式放行记录

正式流程需检查批准记录与对应素材的哈希，不能仅有任意环境变量就当作法律批准。
维护者尚未提交 LICENSE_APPROVAL / BINARY_COMPLIANCE_APPROVAL，因此 signed-release 门禁应保持关闭。

## 2026-10-09 技术迁移之后的最新状态（覆盖上文旧包统计，不视为授权）

新工作分支已移除 `ffmpeg-static` GPL-3.0-or-later JS 包装层和 `ffprobe-static` 包装层，重新生成锁文件后为 **414** 个包、其中 **54** 个生产包（此前 428 / 75 的历史库存不再代表当前状态），当前 `npm ls ffmpeg-static ffprobe-static` 返回空结果。原生工具改为固定来源 LGPL v3 二进制，并以 `resources/media-tools` 单独打包；详见 `docs/legal/FFMPEG-SOURCE-CANDIDATE.md` 与 `ffmpeg-source-candidate-inventory.json`。`THIRD-PARTY-NOTICES.txt` 和 `dependency-inventory.json` 按最新锁文件重新生成；原生工具 LGPL 文本随测试包单独附带。

**仍禁止公开分发：** 43 个启用的第三方库需要逐一查清准确构建对应的完整源码/补丁/许可证/静态链接义务并形成审核记录，同时代码和素材版权授权、签名与独立审核、干净 Win11/noNode/历史升级、隐私范围仍阻塞。没有改动 `build/release-approval.json` 或给出源码许可授权。
