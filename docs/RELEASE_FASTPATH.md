# 拉面影视：极简绿色 ZIP 发版 SOP

> **唯一日常发布入口**。开发和发布前后都优先按本文件执行；本文件总结 2026-10-22 成功发布 **v0.1.16 Latest** 的实战步骤。只针对 Windows x64 **未签名、免安装的绿色 ZIP**；不用于 NSIS/签名安装器。详细证据和法律核对见 [源码社区版发行路线](SOURCE_COMMUNITY_RELEASE.md)，旧文档中的 v0.1.15“当前版”描述为历史记录，不能覆盖实时 GitHub Release。
>
> **核心原则：尽量复用通过验证的字节和证据；不在每次应用小改动时重编整个原生工具链；只有确切的最终构建才允许公开。不能靠修改 approved / distributable 字段假装获得批准。**

## 下次发布从这里开始（给 AI 直接执行）

用户提出“发布新版”即授权按本 SOP 准备和执行指定范围的公开发行，无需逐步征询是否继续。只有证据无法验证、实际发行范围变化、不可逆破坏性操作或权限缺失才询问。

1. **确认唯一版本与发布范围。** 读取 `package.json.version`（例如 `0.1.17`）和 `src/shared/displayVersion.json`（界面如 v1.7）；确定上一版 GitHub **Latest**、本次 `Unreleased` 范围、目标正式 tag `v<package.version>`。仅修复发布基础设施、重跑 CI **不**涨界面版本。
2. **保存证据、隔离操作。** 仅用家用电脑，查看 `AGENTS.md` / `git status`，创建项目备份（`scripts/project-backup.ps1`），在独立 `ai/... ` 分支工作；保留用户未提交改动。固定本轮 commit，不混入别的开发实验。
3. **一次性完成变更记录。** 从每次开发已经记录的 `CHANGELOG.md` 和交付文件提取本次正式包含内容，写 `docs/releases/<version>.md`，**必须包含「安全类」「性能类」「功能增加类」**；如无变化标记“本版无”；允许再补“修复与体验”。同步 README、`docs/USER_GUIDE.md` 和 `docs/user-guide/<version>.md`，只宣传已经纳入本次发布的功能。不要写“安装器/签名版”。
4. **按变更类型选最低必要测试。**
   - 应用小修复且原生库哈希未变：复用原生批准和源码包；应用既有 CI、安全检查、packaged smoke、最终 ZIP 解包及改动相关回归即可。不要重复下载、重新编译 MPV/FFmpeg，也不强制另一台实体机器或真实网盘破坏性测试。
   - 涉及清理/数据库/删除：保留相应合成数据的安全测试与恢复检查，绝不直接用真实资料库试删。
   - 原生库/NativeHost 哈希、编译参数或授权素材改变：**仅针对变化组件**补来源、许可、二进制哈希和必要播放测试；历史批准不能覆盖变化字节。
5. **本地只做发布前资料预检。** 在本轮代码目录运行 `node scripts/release-fastpath-preflight.mjs --version <version>`。该命令是**只读**的：检查版本、说明分类、来源审批和证据文件哈希、已有源码锁一致性；失败先修真实问题，不改开关绕过。模板见 `docs/releases/RELEASE_NOTES_TEMPLATE.md`。
6. **走已有单一路线，不重复打包。** 审核无误后提交并正常更新 main，确保该精确 SHA 的 GitHub Windows CI 和 Security audit 为 SUCCESS。生成匹配该 SHA 的精确版本 tag；在 **私有 GitHub Release 草稿**里先准备应用源码、对应原生源码和 `SOURCE-PAIR.json`（哈希与 SHA 一致）。使用现有 `.github/workflows/source-community-build.yml` 的手工 `workflow_dispatch`，选择 tag + `release_class=unsigned-public-release`；云端完成 `dist:zip`、`verify:zip`、基本 smoke，并把真实 ZIP 上传同一私有草稿。**不再另行跑一遍 Windows 安装器发布流程。**
7. **上传后核对六个附件（完整且同一版本）：** `Movie-<version>-Windows-x64-Portable.zip`、`Movie-<version>-Application-Sources.zip`、`Movie-Native-Runtime-<version>-Corresponding-Sources.zip`、`SOURCE-PAIR.json`、`SHA256SUMS.txt`、`RELEASE-VERIFICATION.json`。核对资产的 SHA-256、精确 commit、源码配对和当前 tag。完成后执行 `node scripts/release-fastpath-preflight.mjs --version <version> --published` 的只读验证（**此参数只能在公开后运行**）。
8. **单独公开草稿，完成验收。** 在全部验证通过且确认本次公开范围后，将私人草稿发布为 **正式 Latest（不是 Draft，也不是 Pre-release）**；使用 GitHub API 再确认 Latest tag、资产数、SHA。随后打开发布页核对实际可下载链接。在一条最终消息中同时说明版号、分类更新、下载链接、测试和未覆盖风险。

> 防误发布：`git push` ≠ 软件发布；CI SUCCESS ≠ 绿色 ZIP 已可下载；上传 Draft ≠ 公开发布；只有 GitHub Release **draft=false、prerelease=false、Latest tag 为本版、六个文件实际存在**才称发布完成。用户日常桌面快捷方式更新是另一个任务，未经实测不可宣称桌面已同步。

## v0.1.16 的返工教训 → 固定改法

| 曾发生的返工/障碍 | 下次的预防办法 |
| --- | --- |
| v1.6 界面版本、0.1.16 技术版本与发布说明不同步 | 每次功能修改同时记录 Changelog；发版前统一一次版本及教程，不再开发中反复涨版 |
| 反复切换源编译库、Lite QA 测试库、旧审核运行库 | 先锁定**真实发行 variant**、NativeHost 和 ZIP SHA；测试工具仅用于 QA，不得冒充正式运行库 |
| 原生编译已有成功仍被旧哈希批准阻塞 | 原生文件不变时复用已批准批次；变化时只审变化的文件和许可证；维护应用版本的独立批准，不重跑完整工具链 |
| GitHub CI 的 TEMP 8.3 短路径触发数据目录安全检查和超时 | packaged smoke 临时目录先 realpath；保留 junction 回归测试，不删除目录安全检查 |
| 工作流先前下载依赖 404 或安装路径有差异 | 依赖尽量用固定、经 SHA 校验的已存档资产；同一份最终包只走已验证的工作流 |
| 文档/审批字节在 Windows checkout 后 CRLF 不同 | 关键证据文件固定 EOL，并用 SHA-256 对字节验证；不要直接修改历史已批准附件 |
| CI 提交不是最终打包提交，tag、程序包、源码包不一致 | **冻结 SHA → CI 成功 → tag 指向该 SHA → 应用/原生源码/程序包全部绑定此 SHA**；变化后重新核对 |
| 只完成 Draft 或 CI，误报“已发布” | 公开后查询 GitHub Release 的 draft/prerelease/Latest/六附件，验收后再向用户报告 |
| 为了打包重复执行大量质量门禁 | 小版本只复用 CI 已通过的测试和必要的成品验证；变更相关风险才扩大检查范围 |
| 源码、更新记录散落在多个旧文档 | 这份 SOP 为第一入口；版本变更写一份三分类发行说明，记录到交付文件；历史记录不删除 |


## 实用快捷命令（发布时不要重复整套审计）

### 每次开发完成就记录变化

记录即时写入 docs/releases/NEXT-CHANGES.md；发行说明仍统一复制 docs/releases/RELEASE_NOTES_TEMPLATE.md，与 CHANGELOG.md [Unreleased] 保持同步。

    npm run release:note -- --category safety --text "远端结果未知时禁止自动重试" --tests "合成删除专项 PASS"
    npm run release:note -- --category performance --text "后台任务减少前台等待" --tests "相关回归 PASS"
    npm run release:note -- --category feature --text "新增播放器高倍速" --tests "播放器专项 PASS"

### 只读阶段检查（prepare → draft → published）

    # 先列出审批、版本和原生证据的失配项；所有 BLOCK 都是具体待办
    npm run release:check -- --version 0.1.17

    # 当前 Draft 具备六份附件后，用同一 Commit 的 CI/Security/正式构建来核对
    npm run release:check -- --version 0.1.17 --draft

    # GitHub Release 真正公开后再次确认 Latest、六份附件与 SHA
    npm run release:check -- --version 0.1.17 --published

以上命令只读取文件和 GitHub，不修改任何 Release、tag、用户数据库或正在运行的程序。0.1.17 是示例，必须替换成真实版本。**--draft / --published 必须在该发行 tag 对应的代码检出目录运行**；如果当前开发分支已经有后续文档或功能提交，检查应提示 Commit 不一致，这不是旧发行失败。

### 私有草稿到 Latest 的官方路径

以下是**分阶段**命令，不能忽略上一条失败继续执行：

    # GitHub main 已安全合入本次代码/发行说明后，创建私有草稿
    gh release create v0.1.17 --repo huntian0727/movie --draft --title "拉面影视 v0.1.17" --notes-file docs/releases/0.1.17.md --target main
    gh api repos/huntian0727/movie/releases/tags/v0.1.17 --jq .id

    # 将真实 Draft ID 绑定到本版发行批准；按常规流程提交、让 CI/Security 针对最终 Commit 通过。
    # tag 可能在创建 Draft 时就生成，发布前必须检查最终 tag ^{} 与 main/源码/批准的 SHA 一致。
    git rev-parse HEAD
    git ls-remote --tags origin "refs/tags/v0.1.17^{}"

    # 当前 Commit 对应的应用源码、原生对应源码及 SOURCE-PAIR.json 先上传同一 Draft。
    # 下列手工 workflow 使用正式的 source-candidate，生成真正的绿色 ZIP 并自动暂存 Draft：
    gh workflow run source-community-build.yml --repo huntian0727/movie --ref v0.1.17 -f release_class=unsigned-public-release
    gh run list --repo huntian0727/movie --workflow source-community-build.yml --limit 5

    # 从 GitHub 真实附件 digest 生成 SHA256SUMS.txt 和 RELEASE-VERIFICATION.json，凑齐六件。
    npm run release:check -- --version 0.1.17 --draft

    # 只在以上全 PASS 且维护者已授权公开时执行
    gh release edit v0.1.17 --repo huntian0727/movie --draft=false --prerelease=false --latest
    npm run release:check -- --version 0.1.17 --published

**注意当前架构的 Draft ID → 审批文件 → Commit → tag 顺序。** 公开之前可以在受控流程中核实未发布 tag 与最终 Commit；已经公开的 tag 不得移动，更不能强制推送修正错误发布。原生库字节未变可复用原批准的**该二进制对应源码和许可材料**，不能把 Lite QA 测试工具冒充正式分发运行库。若没做的真实 Windows/网盘验收不可写 PASS。

### 固定最终汇报

相对上个**正式版**的安全类、性能类、功能增加类变化；技术版与左上角界面版；Git main/tag SHA；本版 CI/Security/Source builder 结果；GitHub Latest 下载 ZIP 链接、SHA256、六件附件；未验证事项；家里日常桌面 .lnk 是否另行更新。不把本地源码成功、CI 成功或 Draft 当成公开发行成功。

## 发布记录与交接格式

每次发布在 `docs/ai/deliveries/YYYY-MM-DD-release-<version>.md` 记录固定字段：范围、主分支 SHA/tag、界面版、三类更新、使用的原生组件锁和审批 SHA、确切 CI run、最终 ZIP SHA-256、GitHub Release URL/ID、六个附件、是否 Latest、未做的验收，以及任何必须手动处理的问题。**无事实依据的项写 NOT RUN / UNKNOWN**。不得沿用上一轮 run 号冒充本轮通过。

## 范围外事项

发行版不自动升级正在运行的家用桌面快捷方式；如用户要求安装/覆盖常用版，须独立验证当前进程、快捷方式真实目标和应用左上角版本。不能停止有进行中删除任务的旧程序。安装器签名、自动更新、跨平台发行、新原生工具链更换等均需另立项目，不是小更新的默认阻塞。

**快速只读命令：**
```powershell
node scripts/release-fastpath-preflight.mjs --version 0.1.17
# GitHub Release 公开后再运行：
node scripts/release-fastpath-preflight.mjs --version 0.1.17 --published
```
