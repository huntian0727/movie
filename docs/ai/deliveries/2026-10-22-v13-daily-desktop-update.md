# 家里电脑日常使用版 v1.3：已实际更新（非 GitHub 正式发布）

执行日期：2026-10-22。家里电脑 `MP2T8QB5`；仅限个人项目，未使用公司电脑。

## 用户最新执行规则

用户明确要求：**每次功能修复或更新，都更新日常使用的桌面软件版本，不能只有代码、开发目录或单独测试包。** 细则已提交至 [`docs/ai/DAILY-DESKTOP-UPDATE-POLICY.md`](../DAILY-DESKTOP-UPDATE-POLICY.md)。本规则替代此前“全部问题修完后才更新日常桌面程序”的做法；GitHub 公开发布仍需用户另行指示。

## 本次实际更新

- 项目分支：`ai/fix-duplicate-background-banner`。
- 功能修复提交：`36d7929`（清理已完成时自动隐藏进度条，并移出其他菜单），`5a928a5`（播放器 0.5×～2× 倍速，普通 HTML5 与内嵌 MPV）。
- 界面版本提交：`a370b8edc307a04ca83da8732b08c7b32a9ed4a7`，两位数界面版本从 `v1.2` 增至 `v1.3`；安装器技术版本仍为 `0.1.16`。
- 用户桌面入口：`C:\Users\test\Desktop\拉面影视.lnk`，已再次通过 COM 读取快捷方式目标，实际指向 `C:\Users\test\Documents\视频管理\movie\release\win-unpacked\拉面影视.exe`。
- 本次先用 `MOVIE_SAFE_STAGE_LOCAL=1 npm run package:development` 打至 `release/local-optimized/win-unpacked`；核对生成包 `resources/build-flavor.json` 为 `displayVersion=1.3`、`releaseClass=local-development`、`commit=a370b8ed...`、文件存在且新原生宿主 DLL 俱全。由于工作区中仍有其他开发者未提交的 CI/文档改动，该 build-flavor 的 `workspaceDirty=true`，不影响本次功能提交号或代码构建；这些未提交内容没有覆盖。
- **实际部署**：确认没有运行中的 `拉面影视.exe` 后，原始 `release/win-unpacked` 重命名完整保留为 `release/win-unpacked-backup-v1.2-before-v1.3-20261022`；隔离构建目录移到真实快捷方式的原目标 `release/win-unpacked`，快捷方式路径不变。旧备份 `resources/build-flavor.json` 仍明确显示 `v1.2`，新目录显示 `v1.3`。
- 新常用程序 EXE SHA-256：`A4F772771ECF8E30A6E86873DA1D6FB3C0DCBC08D86F3372BE3756D1A1716ED7`，替换前后核对一致。
- **直接针对用户真实桌面快捷方式 EXE** 执行 `node scripts/run-packaged-smoke.mjs --executable <shortcut target>`，使用隔离临时用户数据，create + verify 两阶段全部通过：SQLite quick_check / 资料库 worker / 搜索、导出、数据库重启 / renderer 资源及安全等。新 v1.3 源码早已完成定向 95/95 测试、C# 宿主隔离编译成功。
- 没有启动真实视频删除，没有修改正式用户数据库、没有覆盖公司电脑、没有推送 GitHub、没有创建正式 ZIP/installer/release。播放器真实人工视听/网盘端到端仍待后续合适时机，不能用 packaged smoke 替代。

## 回滚

先确认程序已退出且无后台删除任务，再将当前 `release/win-unpacked` 移走，备份 `release/win-unpacked-backup-v1.2-before-v1.3-20261022` 复位为 `release/win-unpacked`，快捷方式仍然有效。不要操作用户数据目录 `%APPDATA%`。

## 下一步

用户继续反馈修复事项时，直接在家里电脑实现、定向验证、界面次版本增 1，并部署至桌面快捷方式所指的**常用目录**。不能把独立候选、GitHub PR、测试包当作“日常桌面已更新”。只有确认真实快捷方式 EXE 对应新版本后才能宣布完成；正式 GitHub 公共发版另行决定。
