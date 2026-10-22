# 拉面影视 0.1.16 正式绿色版发布交接与验收

## Context

维护者于 2026-10-19 明确要求将最近日常开发完成的功能正式打包发布到公网，更新线上说明与近期更新记录；上一公开 Release 为 v0.1.15，故新版本定为 0.1.16。仅使用家用电脑 MP2T8QB5，不操作办公设备。

## Ownership / baseline / backup

- Owner: ChatGPT；工作分支 ai/release-0.1.16-community；基线 de79c41b1cc491d43ddc21f0fa0b14baf1136f30。
- 开工工作区干净；完整开发前快照 2026-10-19_10-10-21-830_public-release-0.1.16，包括 SQLite 一致快照（0.91GB/363528 videos/quick_check OK）。
- Git checkpoint 标签 checkpoint-20261019-181017-de79c41-public-release-0.1.16 已推送，按保留规则校验并清理旧备份完成。
- 原生产视频及用户资料库绝不参与删除、重扫或迁移试验；正式候选程序测试需要独立资料库或真实资料库的关闭备份副本。

## Intended changes

- 将 package.json 与 package-lock.json 版本升至 0.1.16。
- CHANGELOG.md 把 0.1.15 之后的新增/修复归并到 0.1.16，新建空的 Unreleased 部分。
- README.md、docs/QUICK_START.md、docs/USER_GUIDE.md、docs/user-guide/0.1.16.md、docs/releases/0.1.16.md、docs/SOURCE_COMMUNITY_RELEASE.md 与未来 Release 正文使用一致下载链接与版本号。
- 范围：异常中心任务与问题独立、批量确认与处理历史、数据目录迁移与离线帮助、CloudDrive API 导入直达设置、错误计数与布局改进。

## Verification to complete

- 旧公开 0.1.15 Release 链接、8 个公开资产存在，GH 登录具备 repo/workflow 权限。原生套件 39 个 PE 固定对应源码与许可材料可按 SHA 复用，但必须实际检验字节。
- 已成功从既有私有输入草稿按 2 个 pinned SHA 下载 39.8MB 原生运行库与 255.05MB 源码审阅输入。
- 初次在未提交工作区运行 unsigned-community-qa 私有 ZIP，被 run-electron-builder.mjs 的“Formal packaging requires a clean reviewed checkout”正确拦截（安全门有效）；需要在完成文档并正常提交后重新运行。
- 需要完整应用回归、针对改动的 Windows Sandbox GUI、最终发布类源码/许可一致性检查、实际成品 ZIP SHA/对照文件、GitHub CI 与 Security audit、正式版来源配对。
- **不能把已有 v0.1.15 Windows 沙盒证据单纯复制改版本就声明 v0.1.16 已完成沙盒验收。** 正式 approval/QA 文件必须由真实本版 Windows 沙盒验收填充，保留实际 OS build 与范围限制。
- 发布前先建立严格一致的版本 QA/审批记录和私有产品草稿，并按原有正式 Workflow 生成及暂存准确的新 ZIP。成功之后才能公开 Release（须提供成品、SHA256SUMS、精确应用源码、原生对应源码、SOURCE-PAIR、RELEASE-VERIFICATION、build-metadata）。
- 发布后无认证核对 GitHub 下载地址/资产大小/哈希/说明链接。保留原有 v0.1.15 Release 与 tag，不创建签名或 NSIS 发行版。
- 用户已授权正式对外公开。若打包许可、沙盒、GitHub 上传缺失，必须如实报告并停止公开，不绕过任何门禁。

## Collaboration / Handoff history

- 2026-10-19：started；status in_progress。下一步提交候选版本文档，跑 CI/私有 QA、实测沙盒、完成审批及对应源码配对后才可发布。
