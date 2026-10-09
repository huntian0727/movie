# 公众发行：需要维护者统一决定的事项（2026-10-08）

此表是决策请求，**不是授权记录**。在权利人明确批准并留下可校验的证据之前，不得修改 `build/release-approval.json` 的默认拒绝状态，也不得发布公开安装包。

| 决策 | 需维护者明确确认 | 工程建议 / 当前处理 |
| --- | --- | --- |
| 自有代码与素材的权利 | 确认本人对历史提交、图标、截图、引用代码、NativeHost C# 及 AI 生成部分拥有公开授权所需权利；列出非本人授权的部分 | Git 历史有 Codex、dependabot、仓库所有者三类作者身份；提交人名称不足以证明第三方代码权属。当前不授予任何项目许可 |
| 应用许可证 | 选择 MIT、Apache-2.0，或暂缓；确定署名与版权主体 | MIT 较简短、宽松；Apache-2.0 含明确专利授权。项目许可**不替代** FFmpeg 和 JavaScript 包装层许可审查 |
| 高风险永久删除 | **已按用户默认授权选择保守策略**，当前不再等待额外决策 | 2026-10-09 实施：元数据快速永久删除整个模式暂时关闭，不提供 opt-in 开关；只有完整 SHA-256 验证并二次输入 `DELETE` 后才可执行真正永久清理。旧 `autoDeleteAfterVerification=true`、筛选全集 API 快速删除及历史 workflow3 的续跑/重试均失败关闭。若将来想重新开放“快速删除” opt-in，必须另行评审显式逐任务确认及安全协议，不能自动恢复旧默认 |
| 正式签名 | 决定个人或组织证书主体、供应商/云签名服务与证书托管方式，以及预期发布者完整 CN | 当前 GitHub Actions 采用 PFX/electron-builder，需在 GitHub Environment Secrets 设置 `WINDOWS_CSC_LINK`、`WINDOWS_CSC_KEY_PASSWORD`，Variables 设置 `WINDOWS_EXPECTED_PUBLISHER`。**不在聊天中发送密钥/密码** |
| 独立审核人 | 提供可信任的第二个 GitHub 账户，并授权其审核正式发行 | 当前仓库可查询到的 collaborator 仅维护者本人；`public-release` 环境接口为 404。门禁要求 required reviewer、prevent self-review、禁止管理员绕过、仅 `v*` 标签部署；没有独立人选不得放宽 |
| 发布审批变量 | 为完成审查后赋值，不是为了绕过阻塞 | `RELEASE_LICENSE_APPROVED`、`RELEASE_BINARY_COMPLIANCE_APPROVED`、`RELEASE_MANUAL_QA_APPROVED` 均须有实际通过材料后才设为 true |
| 干净 Windows 与历史升级 | 提供独立的稳定 Win11/no-Node 虚拟机或测试机；确认是否存在旧**正式签名**安装器及旧版本资料库的合成测试快照 | 只能使用合成视频/SQLite。若无旧正式签名包，升级项目保持 NOT_RUN，不得把 repair 改称历史升级 PASS |
| Git 历史公开范围 | 选择保留已有公开 Git 历史，或明确批准后专项处理；确认历史个人路径、开发叙述和 Git 作者身份是否可公开 | Gitleaks 零 secret 不能推出个人信息已授权。未经批准绝不重写历史、不批量清理上游许可证署名 |

## 原生媒体替代候选的独立审核范围

实际候选：BtbN/FFmpeg-Builds 2026-10-05 的 `n9.0.2-22-g46d8f462ee` Windows x64 LGPL static。
已验证发行 zip SHA-256、相同的 FFmpeg/FFprobe 版本及配置、两个 EXE 与 zip 提取结果的精确哈希、PE x64 与 LGPL 声明。候选测试未覆盖程序真实发行接入，也**尚未完成**对应源码、外部库源码/许可证、构建脚本/补丁及法律审查，不能批准公开分发。
现有 `ffmpeg-static` JavaScript 包装层另为 GPL-3.0-or-later，需要作为独立授权问题处理；不能直接用“子进程调用”消除其义务。

## 签名就绪前不得宣称完成

正式签名需要实际覆盖安装器、应用程序和 NativeHost.exe 的发布者、可信时间戳和校验和；当前 unsigned 安装包仍不可公开 Release。审批状态保留失败关闭，PR #24 继续 Draft，不合并 main、不建版本 Tag。
