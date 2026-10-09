# FFmpeg 源码引用闭包：初步审计（2026-10-09）

> 本文及 `native-media-recipe-evidence.json` 仅证明**候选构建脚本中的来源引用被找到**。二进制与源码的对应性、完整源码归档及全部许可证未审核完成。**不可批准公开分发**。

## 本轮实际核验

使用家用机 B5 的隔离目录中已有的 BtbN/FFmpeg-Builds 源码快照：

- 提交：`9acad4a9ef1583096af7836cc1e9c8cbcb4d3950`
- 源码压缩包 SHA-256：`27dca8db7b2466b6f5145168721264de91dc9b56f50bebc441249f92e4acf548`
- 已运行 `scripts/audit-native-media-recipes.mjs`，先验证压缩包 SHA，再逐一解析现有库存所引用的 recipe。
- **43** 项 FFmpeg `--enable-lib*` 标志对应 **44** 份候选 recipe，源代码引用涉及 **42** 个不同的库仓库地址。
- **43** 份 recipe 使用明确的 40 字符 Git Commit；`libmp3lame` 的 recipe 通过 SVN **revision 6835** 固定来源，不应误标为没有固定版本。
- **16** 份 recipe 明确列出一项或多项简单 `echo` 形式的直接依赖，共发现 **18** 种依赖名称候选。此数量**不是完整传递依赖数**，也没有静态执行脚本求完整构建图。
- **2** 份 recipe 指向脚本源码中的补丁目录，识别到 **4** 个待核实补丁文件及 SHA-256：`libaom` 一份、`libaribb24` 三份。其他目录和脚本生成的变更仍可能存在。
- 结果保存于 `docs/legal/native-media-recipe-evidence.json`，包含每个 recipe 的精确来源 URL、固定修订号、文件哈希、依赖提示和相关补丁文件哈希。所有授权标记固定为 **false**。

## 两份许可证原件的独立核验

在 B5 家用机上，使用 GitHub API 按同一个精确提交，取得并哈希**原始 COPYING 文本**：

| 库 | 源码提交 | COPYING SHA-256 | 已读出的许可 |
| --- | --- | --- | --- |
| opus | `503d81b138d76621aae4b12786e90de48aa8db3a` | `01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551` | BSD 风格声明/免责声明及二进制再分发条件 |
| libass | `f61db567e6593df3470e91594bcd4ad2d0473aff` | `f7e30699d02798351e7f839e3d3bfeb29ce65e44efa7735c225464c4fd7dfe9c` | ISC License，需要保留版权和许可证声明 |

原始文本只保存在 B5 家用机的 `D:/CodexReleaseAudit/media-candidate-20261008/source-evidence/exact-component-sources/` 中。此外，B5 家用机的 TAR 下载在首次网络超时后自动重试成功，**实际归档了两份完整、精确提交版本的上游源码 TAR**，并通过完整 `tar -tzf` 校验：Opus（4,957,402 字节，SHA-256 `e34101b726c033be40e3f5a2695d086362d59069554ffd46800c38a13eade1f7`，840 个 TAR 条目），libass（352,592 字节，SHA-256 `edb3e866ca9394152484bc9a83b68a395f5c9052ae0dc502e4100035c250330b`，155 个条目）。两个 TAR 均包含 `COPYING`。它们保存在上述 B5 D 盘隔离目录，不进入 Git 或公众安装包。

**注意：这仅表示已实际取得 43 个启用库中两项的完整源码归档，不代表两个库已经完成所有传递依赖、构建补丁适用性或与发布版 Windows 二进制的对应证明。** 自动生成的 recipe 表仍统一标记 `sourceArchiveRetrieved=false`，因为该表仅基于单一构建源码仓库，不将外部隔离材料自动当作合规批准；两份实际归档以此补充记录为准。

## 需要继续补足的证据

1. 按实际 Windows x64 LGPL 静态构建变体，确认 43 项启用库以及传递依赖**确实被编入最终二进制**，不能仅依赖 recipe 文件名或编译开关。
2. 下载完整相应源码归档并记录二进制与源码的可验证对应、补丁应用顺序、编译器/容器镜像/配置；当前已确认 recipe 引用但**未归档和复现所有来源**。
3. 逐库确认许可证、著作权/通知、静态 LGPLv3 的提供对应源码及必要重新链接材料的义务；`ffmpeg-static` JS 包装层已移除，但这不能替代原生工具的授权义务。
4. 解决 2026-10-05 每日构建保留期短的问题，选择长期可获得、可复现且对应源码归档完备的来源。
5. 新的可公开分发版本仍需代码/素材版权决定、真正干净 Windows 11 验收、旧正式签名版升级、正式签名/独立审批和历史隐私审核。

## 验证命令

在**家用机 B5** 工作树中使用已有的隔离源码（命令只读取源文件并更新审计 JSON）：

```powershell
node scripts/audit-native-media-recipes.mjs --source-root "D:\CodexReleaseAudit\media-candidate-20261008\source-evidence\FFmpeg-Builds-9acad4a9ef1583096af7836cc1e9c8cbcb4d3950" --source-archive "D:\CodexReleaseAudit\media-candidate-20261008\source-evidence\BtbN-FFmpeg-Builds-9acad4a.tar.gz"
npm run test:media-candidate-contract
```

所有项目授权、二进制源码合规及正式分发门禁继续默认拒绝；**公众发布 FAIL**。
