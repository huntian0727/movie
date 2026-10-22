---
date: 2026-10-22
branch: ai/release-fastpath-playbook
type: docs
status: completed
updated: 2026-10-22
---

# 拉面影视 v0.1.16 发版经验固化（首次交接文档·最终覆盖版）

> 本文件是**首次发行经验沉淀文档的原位覆盖修订**，不是一套新的发布流程。今后只维护和执行唯一主手册：[docs/RELEASE_FASTPATH.md](../../RELEASE_FASTPATH.md)。这份交接记录保留做过什么、为什么、如何验证；详细历史问题另见 [完整复盘](2026-10-22-release-fastpath-retrospective.md)。

## Context｜目标和发布事实

- 维护者只需要一个可快速复制执行的个人开源 Windows x64 **未签名绿色 ZIP** 发布方案，要求少确认、少重复工作，不把 NSIS/签名安装器或无关的企业级流程混进小版本。
- 已公开正式版：**[v0.1.16 Latest](https://github.com/huntian0727/movie/releases/tag/v0.1.16)**；界面版本 **v1.6**。正式发布 SHA：`159db20738d4e36243fdcf57cc8997e41fbea818`，GitHub Release ID `420326400`。
- 正式 ZIP `Movie-0.1.16-Windows-x64-Portable.zip`：214,780,766 字节；SHA-256 `fcf37f55e7c2cab21c051aaad0534560ca2f5007ebf163399648e0d4115fa703`。
- 同一发布 SHA 的 Windows CI `39733324623`、Security audit `39733324536`、Source builder `39734209982` 均为 SUCCESS；六份发布附件齐全（程序 ZIP、应用源码 ZIP、Native 对应源码 ZIP、SOURCE-PAIR.json、SHA256SUMS.txt、RELEASE-VERIFICATION.json）。
- 没有声称完成稳定 Windows 全配置认证或真实 CloudDrive/115 永久删除；**发布成功不代表未运行的测试通过**。

## Changes｜这次最终留下的可复用成果

**唯一 SOP（必须优先）**：`docs/RELEASE_FASTPATH.md` 已合并初版和后续改进，逐步说明「冻结版本与范围 → 保留备份 → 本轮差异分类 → 精准证据检查 → 同 Commit CI/安全审查 → 绑定审批/Draft/tag/源码 → GitHub 生成绿色 ZIP → 六附件核对 → 发布 Latest → 公开链接验收」。**不要再制作第二份相互矛盾的 SOP。**

**开发过程三分类记录**：

- `npm run release:note -- --category safety --text "真实安全变更" --tests "实际验证"`
- `npm run release:note -- --category performance --text "真实性能变更" --tests "实际验证"`
- `npm run release:note -- --category feature --text "真实新增功能" --tests "实际验证"`

记录位置 `docs/releases/NEXT-CHANGES.md`；同时维护 `CHANGELOG.md` 的 `[Unreleased]`、受影响用户教程和开发交付文件。发版时依据 `docs/releases/RELEASE_NOTES_TEMPLATE.md`，**逐项对比上一公开正式版**，按「安全类 / 性能类 / 功能增加类」呈现；没变更的分类明确写本版无，绝不捏造更新。

**发行前后只读检查**：

```powershell
# 准备版：尽早发现版本、审批、源码哈希和更新说明冲突
npm run release:check -- --version 0.1.17

# Draft 六附件齐备后（须在目标发行 tag 对应的源码检出目录运行）
npm run release:check -- --version 0.1.17 --draft

# 公开完成后确认非 Draft、非 Beta、Latest 与六附件
npm run release:check -- --version 0.1.17 --published
```

`0.1.17` 仅为下一版举例，务必替换为真实版本。工具 `scripts/release-fastpath-preflight.mjs` **不会上传、修改审批、打包、推送、移动 tag 或发布**；它用 BLOCK 提前暴露目标版本、Hash、GitHub Draft ID、同一 Commit CI、安全审计和正式 Builder 失配。最终构建与许可校验仍由现有 GitHub workflow/发行审批负责。

**已同步规范和文件**：

- `AGENTS.md`、`docs/DEVELOPMENT_AND_RELEASE.md`、`docs/OPEN_SOURCE_RELEASE_SIMPLE.md`、`docs/RELEASE_CHECKLIST.md` 均指向同一个正式入口。
- `docs/releases/RELEASE_NOTES_TEMPLATE.md` 作为唯一三分类模板；`docs/releases/NEXT-CHANGES.md` 记录下一版开发变化。
- `scripts/release-record-change.mjs` 负责追加变更，`scripts/release-fastpath-preflight.mjs` 负责只读校验；`package.json` 仅增加 `release:note`、`release:check` 两个调用入口。
- `tests/scripts/releaseFastpathPreflight.test.mjs`、`tests/scripts/releaseRecordChange.test.mjs` 验证检查脚本和记录工具。
- **纯发布文档/工具变动不提高 v1.6 界面版本，也不重复创建 v0.1.16 Release，更不会把源码推送当做桌面程序已更新。**

## 复盘：为何慢、下次怎么避开

| 本轮实际返工点 | 下次固定处理方式 |
| --- | --- |
| 简单打包被扩为安装器、签名和不必要的重复审计 | 先定范围为未签名绿色 ZIP；验证本次变化及真实发行安全边界，不重复做无关流程 |
| FFmpeg/MPV 新构建版本和已批准源码/二进制失配 | 组件**字节不变**时复用已经核准的准确材料；NativeHost 或确实改变的组件仅补自身审查 |
| Windows TEMP 8.3 短路径、BtbN 临时下载 404 | 复用已修复的路径规范化、固定来源及 SHA；失败只定位并重跑相关专项 |
| CRLF/LF 与 review、NativeHost 源码审批 SHA 不匹配 | 先核对 `.gitattributes` 和实际字节，不编造哈希、不直接放宽审批 |
| GitHub CI 是旧提交、Draft/tag/审批因更新发生循环 | 锁定最终提交和实际 Draft ID；每次发布前校验同一 SHA/tag/源码/附件；已公开 tag 不移动 |
| CI SUCCESS / 草稿上传被当成发布成功 | 最后必须查公开 `Latest`、六附件、程序的真实校验和可访问的下载页 |
| 下次找不到此前改了什么 | 开发过程用 `release:note` 实时记录三分类，发版只对照上一正式版编写说明 |

## Verification｜已经实际执行的验证

- 两个 JS 发布辅助脚本 `node --check` 通过。
- 新增的快速发布检查与日志记录测试：`6/6 PASS`；本地 `npm run release:check -- --version 0.1.16`：`19/19 PASS`。
- 初次固化与整合时，同一工作区完整 Node 测试 `1415/1415 PASS`，build、typecheck、Electron smoke 通过（这是**初次交付**的实际结果，并非本次文档覆盖修订重新运行）。
- 首次交付 GitHub `main` 提交 `45ece1b55dcc5973a0cbdc2cc64a968a278a7069` 的 Windows CI `39738781263`、Security audit `39738781279` 均已确认 SUCCESS。
- 原初备份 `2026-10-22_06-47-58-327_release-fastpath-playbook`，该次 checkpoint tag `checkpoint-20261022-144753-159db20-release-fastpath-playbook`；交付中还建立过独立安全备份。
- 没有为纯文档和只读辅助工具重新打包 GUI、改变日常桌面快捷方式或执行真实破坏性网盘删除：均为 **NOT RUN / 不适用**。

## Risks and follow-up｜以后直接执行的约束

- 唯一入口就是 `docs/RELEASE_FASTPATH.md`，本交接文档**不替代 SOP**；更多历史原因查 `2026-10-22-release-fastpath-retrospective.md`。
- 不变的原生库不从头编译；**有变化的 Native 二进制、许可证、对应源码、删除/数据安全边界不能跳过**。用户已授权的既定范围内少问多做，普通环境错误自行定位。
- `--draft` / `--published` 必须在目标发行 SHA 的检出目录执行，否则当前分支新提交会触发正确的 SHA 失配拦截；不能因本地检查不一致就移动已公开 tag。
- 仍只用**家里电脑 MP2T8QB5**；用户日常桌面版本与公开 Release 是不同交付链。真实用户库/媒体不能被发版脚本清理、迁移或用于破坏性验收。
- **此次覆盖修订本身只更新最初的交接记录**，不得另造一版发布包或改动公开 v0.1.16 的资产。
