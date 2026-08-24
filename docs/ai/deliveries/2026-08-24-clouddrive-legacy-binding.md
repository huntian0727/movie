---
date: 2026-08-24
branch: ai/clouddrive-mount-binding
type: feat
status: completed
---

# CloudDrive 旧资料库快速绑定

## Context

旧资料库中的重复候选只有本地挂载路径，没有 CloudDrive 远端文件 ID 与远端路径，因此不能直接进入 API 批量删除。对几十万条旧记录重新读取视频或执行完整媒体扫描不符合效率优先目标。本次增加只针对重复候选目录的 API 元数据绑定流程。

## Changes

- 自动读取 CloudDrive 挂载点，将本地来源目录映射到对应网盘根目录，并把来源类型、远端根路径和网盘名称持久化到现有来源目录记录。
- 只查询尚未绑定远端身份的大小+整秒时长重复候选；无关视频和无关目录不进入绑定流程。
- 同一个候选目录只请求一次 CloudDrive 目录列表，全局最多 8 个 API 目录请求并发；复用 24 小时目录缓存，不读取视频内容、不计算 SHA-256、不运行 FFprobe。
- 只有远端文件名唯一、文件大小一致且 API 返回有效文件 ID/路径时才回填；缺失、大小变化、重名歧义和目录读取失败均保留原数据库记录并分别统计。
- 重复项页面新增“快速绑定旧资料库”按钮。完成后立即刷新候选，已补齐远端身份的项目可以进入全筛选 API 批量删除。
- 新增绑定服务、数据库回填、IPC/preload 契约及界面回归测试。

## Verification

- `npm run typecheck`：PASS。
- `npm test`：PASS，49 个测试文件、504 项测试全部通过。
- 定向测试：绑定服务、数据库重复候选、IPC 契约和重复项界面共 63 项通过。
- `npm run package:dir`：PASS；已重新生成 `release/win-unpacked/Local Video Manager.exe`。
- `npm run verify:artifact`：PASS；ASAR 共校验 3958 个条目。
- `npm run test:packaged-smoke`：PASS；创建、数据库、协议、renderer/preload、安全负向检查与媒体工具检查全部通过。
- 桌面实机验证：PASS；真实资料库的重复项页面显示 13790 组，并确认“快速绑定旧资料库”“添加优先保留目录”“批量删除全部筛选结果（13790 组）”和“不计算 SHA-256”说明均存在。验证未点击绑定按钮或删除按钮，未修改用户真实资料库。

## Risks and follow-up

- 自动绑定依赖现有 CloudDrive API token、端点和挂载点信息。未映射到已挂载 CloudDrive 根目录的本地来源会被统计为“无法映射”，不会写入猜测路径。
- 首次绑定的网络请求量取决于重复候选分布在多少个目录，而不是资料库总视频数；后续重复运行只处理仍未绑定的候选并复用目录缓存。
- 本次只更新数据库中的远端身份和 API 修改时间，不移动、不改名、不删除任何文件。
