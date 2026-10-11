# 固定 libmpv 候选的源码交付缺口

2026-10-11，北京时间。**技术材料清单 / NOT APPROVED**，没有改变发行审批。对象是 `libmpv-2.dll`，SHA-256 `8ca42a74311b813abc21f4264e7ed5f12a16419596bcbda96e49f10f8187befe`。

此前已经取得准确的 mpv 主源码、内嵌 FFmpeg 主源码、构建配方源码与 mpv 原始许可通知；见 [既有来源证据](MPV-BUILD-RECIPE-EVIDENCE.json) 和 [运行库说明](MPV_SOURCE_NOTICE.md)。这些材料仍然不能代表全部实际依赖的对应源码。

本轮从原始 x64 构建日志的下载命令列出 **89 个目标**，每个目标都能在固定配方源码中找到唯一的 `ExternalProject_Add` 定义，配方文件 SHA 已逐一记录在 [机器清单](MPV-SOURCE-GAPS-INVENTORY.json)。包括头文件、工具、打包目标，不能把 89 当成 DLL 实际链接库数量，也不能把配方的版本字符串当成实际二进制所用的依赖版本。

## 2026-10-11 继续恢复的实际材料

从同一份已锁定哈希的原始日志恢复了 **21 个目标的更新线索**，结合准确配方、`force_rebuild_git` 辅助函数和提交 API，解析为完整提交 ID。已保存 **19 份源码归档**：18 份新增依赖/头文件候选，加上再次核验的已知内嵌 FFmpeg；逐份校验 SHA-256、大小、TAR 路径，并提取、核验了 **35 份顶层原始通知**。见 [恢复机器证据](MPV-DEPENDENCY-SOURCE-RECOVERY.json)。私人归档目录为 `D:/CodexReleaseAudit/movie-mpv-recovered-candidate-sources-20261011`，附 `MANIFEST.json` 和 `notices/`；未上传为公开源码附件。

这些源码是按构建线索选择的候选。日志中的远端分支更新不单独证明 DLL 最终使用该提交；辅助函数提供更新和重建的推断依据，仍缺原始源树/组件构建记录等证据。OpenSSL 和 ANGLE 头文件的配方指定 `GIT_RESET`，本次采用准确固定提交，而没有采用日志中最新的分支 tip。除原先已从 DLL 确认的内嵌 FFmpeg 外，新增候选均保留 `actualDllRevisionVerified:false`，89 个目标中的 `runtimeExactCommit` 未被这些推断覆盖。子模块、生成配置、完整通知覆盖及最终链接组件清单仍未补齐。

原日志的 Docker pull 输出还恢复了容器 manifest 摘要 `sha256:cd58ab59a9d214aa80bce8ca00be79f97888978f88c906dd3cf32f5b5a1faaca`；这关闭了只有 `latest` 标签的身份线索缺口，尚未归档容器层或复现完整工具链。

上游 x64 debug 附件仍可下载，内层 7z 只有 `mpv.pdb`。已直接解析当前 DLL 的 PE Debug Directory 和该 PDB 的 MSF7 信息流，比对 GUID/age：DLL GUID 字节 `9c13edd1784132bb4c4c44205044422e`，PDB 为 `8f279cec15b1e9d84c4c44205044422e`，均 age 1。**不匹配**，不能用此 PDB 证明当前 libmpv 的依赖输入。内层 7z 哈希与 API 所给外层 artifact ZIP digest 分别记录，没有混用。

fontconfig / SVT-AV1 的完整提交已通过公开 API 解析；常规归档及 API 归档下载均返回 HTTP 406，尚未取得源码包。查询时该 run 的附件列表没有 x64 完整日志附件，公开缓存列表也没有该 run 或其恢复来源 run 的缓存 key。这是查询时的结果，不代表后续保留状态，也不以新构建缓存替代历史输入。

独立的 FFmpeg Lite 私人 REVIEW-v2 ZIP 同时重新核验：239488121 字节，外层 SHA `6ed202c4e30627624e2678a2a62e7c9c6e347be4a57d9b6af248fd45571b15d4`，14 个条目及内部 13/13 文件哈希通过；见 [本轮重核证据](FFMPEG-LITE-SOURCE-REVERIFICATION.json)。这没有改变 Lite 的最终审核状态。

| 待补材料 | 已有材料 | 完成条件 |
| --- | --- | --- |
| 实际依赖版本与输入清单 | mpv / 内嵌 FFmpeg 的实际提交；89 个构建下载目标及配方；21 个版本候选线索 | 从该次构建的源树、缓存、包版本记录或其他可验证产物确认每个实际依赖的准确提交/归档哈希，区分构建工具与最终链接组件 |
| 完整对应源码 | 两份主源码 TAR；配方 TAR；18 份新增候选归档 | 对确认的依赖版本收齐源码、子模块和补丁，记录逐份 SHA；候选归档不能自行成为已确认的完整对应源码 |
| 原始许可与版权通知 | mpv 的 Copyright / GPL / LGPL 原文；35 份候选归档顶层通知 | 依据确认的实际依赖版本核对完整原始通知覆盖及适用关系，不能由顶层文件存在推导审核通过 |
| 构建环境和命令 | 固定配方提交、真实 mpv 配置、原任务日志、实际容器 pull 摘要 | 保存完整工具链/容器材料、配置及必要生成文件；身份摘要不能代替全部实际构建输入 |
| 宿主与运行库发行判断 | 已记录 GPL 构建路径证据，审批仍为 false | 对实际组合形成有依据的书面审核记录，并绑定所审核二进制、源码和通知的哈希；不能由清单生成脚本自行批准 |
| 用户可获得的交付材料 | 本机私人归档 | 按获批交付路线准备完整材料和可验证获取方式；不能把私人主源码归档当成已向公众交付的完整源码 |

上游任务：[准确 x64 构建所属 run](https://github.com/shinchiro/mpv-winbuild-cmake/actions/runs/36943730454)；配方提交：`05a60b3cfd04e3e3b89918f4a27f3dde2935dff2`。原日志显示使用恢复缓存并执行依赖更新/写版本步骤；保存的文本日志没有为全部实际依赖提供完整版本清单。本轮没有用当前 Git HEAD 猜测缺失版本，也没有下载 89 份最新源码来冒充对应源码。

这是 libmpv 构建的材料缺口；扫描/缩略图使用的 FFmpeg Lite 是另一份二进制，仍按 [Lite 静态构建审核记录](FFMPEG-LITE-RELINK-REVIEW.md) 处理。两份构建的源码和审批不能互相代替。
