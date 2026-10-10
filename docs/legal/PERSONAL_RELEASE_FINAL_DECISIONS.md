# 个人免费开源版：发行前最终决策记录

核验日期：2026-10-10。项目：映匣（Windows 程序名“拉面影视”），版本 0.1.15。

## 1. 已核实的 FFmpeg 技术事实

- 当前个人分享版选择 FFmpeg / FFprobe **8.1.2** 的固定 Windows x64 Lite 构建，而非仓库中历史 GPL/旧 FFprobe 候选。发行方：serversideup/ffmpeg-lgpl-builds v8.1.2-27。
- 家用 B5 从**实际暂存二进制**验证：FFmpeg SHA256 `dd2ae91c672ecc7d9233a7ed075dc9437aa817cfb68dce66b172bd61e25cbbe4`；FFprobe SHA256 `57dec3db58729d5f00794bf65d76f15f9278c457989e4a649a02063abdd19bc8`；FFmpeg `-L` 报告 GNU LGPL 2.1 或后续版本。
- 实际 `-buildconf` 含 `--disable-gpl --disable-nonfree --disable-version3 --enable-static --disable-shared`。宿主 Electron 应用通过独立进程调用，不直接链接 FFmpeg libav*；**不能由此推导静态 FFmpeg 可执行文件本身没有 LGPL 义务**。
- 已有 FFmpeg 主源码、固定构建脚本、四份 MSYS2 对应源码、准确 SHA 和许可证；源码 ZIP（239,498,523 字节，SHA256 `a996afcfd3f2601d0ef324f635d2c63adbb3abfb441c1d5aa0c87652db3258b4`）在 B5 私有目录中，内容 15/15 校验通过；离线 Release 资料也已生成、校验。
- 媒体依赖中的 LGPL 许可证、oneVPL、OpenH264、winpthreads、GCC 许可说明已暂存并做过 SHA 固定；实际公开下载页须包括适用的原始许可条款及对应源码。精确文件见 `scripts/native-media-lite.lock.json`。
- LGPL v2.1 §6(a) 提供了发行源代码及必要可重链接材料的途径，**但目前尚无完整“修改 FFmpeg 并成功重新编译/链接”的实测记录**，也没有一份完整适用性意见。因此状态是 `TECHNICAL_EVIDENCE_READY; STATIC_RELINK_COMPLIANCE_NOT_CONCLUSIVELY_VERIFIED`。
- **OpenH264 专项提醒：** 当前 `libopenh264-7.dll` 来自 MSYS2 编译包，不是 Cisco 分发的特定二进制。BSD 版权许可和 Cisco 对其自有二进制的额外 AVC/H.264 专利安排是两回事；不得宣称当前 DLL 已获得 Cisco 提供的免费专利许可。不要把项目“免费”当成专利豁免。

官方参考：[FFmpeg 法律说明](https://ffmpeg.org/legal.html)、[LGPL v2.1 §6](https://opensource.org/license/lgpl-2-1)、[Cisco OpenH264 binary policy](https://chromium.googlesource.com/external/github.com/cisco/openh264/+/refs/heads/gh-pages/BINARY_LICENSE.txt)。

**本项结论：** 无需自动改用动态 DLL，现有二进制与已归档源码足以开展最终具体核验；但缺乏重新构建/重链接证据前，不能将“许可证完全履行”勾为已通过。发布时必须提供本次真实安装器对应源码、许可证和必要重链接材料（如适用）。

## 2. 项目自身代码与素材权属

**所有者已确认（2026-10-10 13:36，北京时间）：** 在本次对话中，针对“本项目的自有代码、文档和三张测试截图，是否都是你有权以 MIT 许可证公开分享的内容？”的问题，项目所有者明确回复“确认”。此确认针对**仓库自有代码、文档和已审阅的三张截图的授权权利**，不涵盖 FFmpeg、运行库或其他第三方资产，也不表示某个尚未通过 QA 的安装包已经获准即时发布。故 `build/release-approval.json.ownersConfirmed=true`，而总 `approved=false`、`manualQaApproved=false`、第三方 `distributable=false` 继续保持关闭。

| 项目 | 当前直接证据 | 结论 |
| --- | --- | --- |
| Git 仓库所有人 | `huntian0727/movie`，README 明确个人免费分享 MIT | 公开分享意图明确 |
| 自有代码许可证 | 根目录 `LICENSE` 已写 MIT，版权署名 `huntian0727` | 技术上已配置，**仅能授权自己有权许可的内容** |
| Git 历史署名 | 历史有 `huntian0727`、`Codex <codex@example.com>` | 记录并非全部真实权属证据，AI 提交不证明第三方输入素材有授权 |
| 项目应用源代码 | 自有 Electron/React/TypeScript、原生 C# 桥接代码，与 npm/Electron 依赖分开 | 可按 MIT 分享的范围仍需权利人确认 |
| 仓库 JPG 截图 | `docs/screenshots/public-release-delete-warning.jpg`、`public-release-duplicate-empty.jpg`、`public-release-library.jpg` | **已实际逐张目视检查**：均为本项目界面与合成示例 `sample.mp4`、测试目录，不见真实人物、第三方电影画面、公司标识或个人敏感路径。截图是否有权以 MIT 一并发布仍由项目所有人最终确认 |
| FFmpeg、字体/图片/第三方依赖 | 另按各自许可证，MIT 不覆盖 | 通过第三方声明独立履行；禁止声称归自己所有 |

**上述自有资产的权利确认已取得；无需再请用户重复确认这一问题。** 对应对象是自有代码、文档和上述三张截图，不是第三方依赖或未来未知素材。

用户明确确认上述自有代码和截图具有 MIT 授权权利；此文件记录确认事实，并非第三方资产的授权证明。截图已完成一次真实目视内容检查。

## 3. 正式发行授权与还需等待什么

用户已授权**为公开发行做好一切研发与材料准备**，也已选择无需购买代码签名证书的独立免费社区身份；但 **并未要求当前立即公开安装器**。干净稳定 Windows 11 的安装/真实播放/卸载测试排在剩余工作之后，办公 D200707 仅可作为隔离测试宿主。

目前项目审批中 `ownersConfirmed=true`，**自有资产的权利确认已完成**；但 `approved=false`、`manualQaApproved=false` 仍保持不变，因为 FFmpeg/原生运行库的适用分发条件尚未最终收口，干净稳定 Windows 11 的真实验收仍未进行。不得提前创建 Release tag、公开安装器或将 unsigned-test-build 改名。

最终授权程序仅需维护者在核对真实代码/素材、FFmpeg 发行材料、对应安装器与哈希、独立 Win11 QA 证据后，明确表示“同意公开发布这个已验证的社区版本”；届时按工程验证规则更新必要证据和审批记录。用户无需企业法务流程、合同或代码签名证书，但仍须遵守许可文本和实际授权范围。

**本文件只是一页式决策和证据记录，非正式法律意见。**
