---
date: 2026-09-26
branch: ai/playback-diagnostic-refresh-fix
type: fix
status: completed
---

# 播放诊断真实文件状态检查

## Context

播放诊断页原“重新读取缓存”只会再次读取同一条 SQLite 记录，不会访问本地文件，也不会刷新 CloudDrive 远端目录。因此文件在资料库外被删除后，该按钮无法发现变化，页面仍持续显示过期记录。

开发前已创建完整项目快照 `2026-09-26_14-30-08-369_playback-diagnostic-refresh-fix` 和本地 Git 检查点 `checkpoint-20260926-222946-fa6ed9c-playback-diagnostic-refresh-fix`。检查点推送因网络连接被重置而失败，本地快照和本地标签均已成功保留。

## Changes

- 将播放诊断页操作改为“检查文件状态”，不再把数据库缓存重读描述为文件检查。
- 本地/NAS 来源先确认所属资料库目录可访问，再轻量读取目标文件状态；确认不存在时使用版本保护将记录标记为缺失，存在但大小或修改时间变化时刷新文件版本并重新排队元数据任务。
- CloudDrive 来源复用现有 API 强制刷新父目录并确认远端文件是否存在，不读取视频内容。
- 目录离线、权限错误、网络错误和 CloudDrive 查询失败只显示失败结果，不修改记录，避免把暂时不可访问误判为删除。
- 新标记缺失后发布既有 `video:removed` 领域事件，使视频浏览、重复候选等正常页面及时移除该记录；数据库记录仍保留在异常中心，未执行文件删除或永久记录删除。
- 页面显示本次检查的明确结果，并重新读取更新后的数据库记录。

## Verification

- `npm run typecheck`：PASS。
- `vitest run tests/main/missingVideoService.test.ts tests/renderer/PlaybackDiagnosticPage.test.tsx tests/renderer/LibraryShell.test.tsx`：PASS，3 个测试文件、79 项测试。
- `npm run test:release-gate`：PASS，76 个测试文件、700 项测试。首次完整运行只因 IPC 契约测试仍匹配旧代码文本而失败，更新契约断言后完整复跑通过。
- 测试覆盖本地文件存在、确认删除、来源目录离线、CloudDrive 强制刷新后存在/删除，以及播放诊断按钮触发与结果回读。
- Windows `dist:win` 打包完成；`verify:artifact`、`test:packaged-smoke`、`test:installer-smoke`、`test:electron-smoke` 均通过。桌面快捷方式已更新到本轮 `release/win-unpacked/拉面影视.exe`。
- 使用正式资料库中的一条 0B CloudDrive 记录进行桌面验证：点击“检查文件状态”后页面进入非阻塞“检查中”，API 强制刷新确认远端文件不存在，随后显示“已标记为缺失”；视频浏览计数从 345,234 即时更新为 345,233，播放与元数据操作停用。未执行永久删除。

## Risks and follow-up

- 本功能只检查单个当前视频，不进行全库遍历，因此不会解决尚未被检查的全部过期记录；批量治理继续通过异常中心或资料库扫描完成。
- 本地检查依赖资料库根目录可访问。根目录离线时刻意不更改记录，这是防止误判的产品约束。
- CloudDrive 检查依赖已配置且可用的 API；API 失败时同样保持原记录。
