# 发布前法律与第三方交付检查（执行用）

**当前状态：NOT APPROVED / BLOCKED；本文是可执行核验清单，不等于法律批准。** 保持 `build/release-approval.json.approved=false`，直到所有实际证据由有权者审查通过。

## 已通过的技术取证

- [x] FFmpeg/FFprobe 8.1.2 Lite Windows x64 版本、哈希、构建来源已锁定。
- [x] 实测 `ffmpeg.exe -buildconf` 有 `--disable-gpl --disable-nonfree --disable-version3`；另外有 `--enable-static --disable-shared`。
- [x] 五个 DLL 与四份 MSYS2 历史二进制包逐字节 SHA 匹配。
- [x] 取得并核验 FFmpeg 主源码、发行方构建脚本及四份 MSYS2 精确源码包。
- [x] 私有 REVIEW-v2 ZIP 内容 13/13 SHA、外层 ZIP SHA 与大小核对通过，材料仍是私有审核候选。
- [x] [构建信息](FFMPEG_BUILD_INFO.md)、[对应源码交付说明](FFMPEG_SOURCE_NOTICE.md)、[组件版本及哈希](NATIVE_COMPONENTS.md)、[顶层第三方声明](../../THIRD_PARTY_LICENSES.md) 均已准备。
- [x] 无签名社区候选流水线、SHA 核对和默认阻止发布门禁已实现；不自动公开二进制。

## 必须获得真实证据后才能勾选

- [ ] FFmpeg 静态构建的 LGPL v2.1 §6/其他适用条款完成逐项审查，确认实际所需对应源码、修改、对象文件或重链接材料；必要时更换满足条款的构建并重新测试。
- [ ] 各运行库的实际许可适用性、版权声明、源码供给、专利/再分发注意事项已经审查并留下文件、人员和日期。
- [ ] 经核验的源码、补丁、构建说明、许可证及必要重链接材料随真实公众 Release 可下载；真实下载链接和每个附件 SHA 已验证。
- [ ] 对应正式用户版本的 About 声明、下载说明、用户文档均包含 FFmpeg 原始许可和对应源码获取路径（不是私有电脑路径）。
- [ ] 所有自有代码、图标、素材与贡献者的权属已核实、批准并保留书面依据。
- [ ] 独立稳定版 Windows 11 x64、无 Node/npm/Git 的安装、首次启动、扫描、缩略图、真实播放、修复、重启、卸载、数据保留已生成可核对证据。参见 [干净 Win11 验收计划](../QA/WINDOWS11_CLEAN_INSTALL_TEST.md)。
- [ ] 维护者逐一确认 `build/release-approval.json` 的真实二进制及证据 SHA 和总批准；没有任何自动脚本自签。
- [ ] 正式公众安装器使用独立 `unsigned-public-release` 身份、重新构建和测试，所有附件与 SHA 都匹配当次发布。

## 发行人判断记录

审查者：**未指派**；审查日期：**未填写**；最终 LGPL §6 技术/法律处理路径：**待核**；公众下载位置：**尚不存在**；发布批准：**否**。

**原则：** 免费、开源和 MIT 自有代码均不豁免 FFmpeg 或其它库许可证。不能将私有源码审核包、单元测试 PASS、About 声明、SBOM、原始 LICENSE 文本替代本节待完成的审核。可查阅 [FFmpeg 官方核验清单](https://ffmpeg.org/legal.html)、[LGPL v2.1](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html)、[详细审核历史](LGPL_COMPLIANCE_CHECKLIST.md)。
