---
date: 2026-10-11
branch: ai/traceable-player-runtime
type: chore
status: partial
---

# 原生播放器源码留存构建流程

## Context

用户选择继续 GitHub 发布。历史 libmpv 构建依赖材料是主要阻塞，重复获取同名源码不能证明对应关系。本轮开发前快照 `2026-10-11_10-05-50-607_traceable-player-runtime`，checkpoint `checkpoint-20261011-180545-6eb39a6-traceable-player-runtime` 已推送，345892 条数据库 quick_check 正常；随后维护脚本校验最近三份开发/迁移快照、清理一份旧开发快照，错误零。

## Changes

- 核验官方 LGPL 候选 ZIP SHA `876619ea77c1891af92500d65939b44ea7bb32175356a740e9d86b6813483b4d`；隔离 DLL 初始化成功，实际 `gpl=false`，但仍静态链接依赖。没有替换当前运行库。
- 新增固定上游配方、动态库、依赖编译前源码留存、工具链源码与二进制导入闭包的构建流程。原始配方结构或 SHA 变化时拒绝执行修改。
- 新增仅手动启动的 CI，程序候选只以接收者公钥加密上传；私钥仅存在本机忽略目录。保留源码证据及机器哈希，未添加 Release 发布权限。
- 增补源码档案与加密安全测试，接入现有 release gate。没有应用行为/界面更改，未产生新桌面包。

## Verification

- 新增源码留存 Python 6/6、私有候选 Node 5/5 测试：PASS。递归 Git 源码与原字节保留、档案替换拒绝、错误接收者/篡改密文/私钥作为公开输入拒绝均实际执行。
- 实际固定原始脚本 SHA 校验及转换：PASS；正式交叉构建：NOT RUN，待本轮提交工作流后执行。
- 锁定 Node 22.23.1 / npm 10.9.8 完整检查：lint、typecheck、build PASS；Vitest 134 文件 / 1204 项 PASS；Electron smoke（SQLite/DPAPI/三身份/移动目录/preload/主进程）PASS；媒体候选契约 65/65 PASS；新源码构建测试 6/6 PASS。独立 E2E npm 脚本不存在，记为不适用。
- 原始配方转换后 `bash -n`、工作流各 shell 步骤语法及 YAML 解析 PASS。真实 CLI 在 `.tmp` 中生成私钥、公钥验证、加密/解密并核对原字节 PASS。完整质量检查后提交脚本 ValidateOnly PASS；使用本轮等价检查的 `-SkipChecks`，正常推送并备份旧 main。

## Risks and follow-up

- 此流程尚未证明新候选真实播放兼容或第三方发行审核完成。新配方关闭 JavaScript/subrandr；字幕渲染使用 libass，需回归。
- 原有公开发行审批及候选锁保持未批准。没有公开程序附件、发行 Tag 或 GitHub Release。
- 稳定 Windows 11 普通用户和最终公开身份 ZIP 验收仍待完成。此次仅构建工具交付，无桌面包更新。
