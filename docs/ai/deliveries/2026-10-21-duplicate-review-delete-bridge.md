---
date: 2026-10-21
branch: ai/duplicate-reviewed-delete-bridge
status: local-implementation
---

# 重复项快捷删除：修复主进程保护规则与页面入口冲突

## 用户可复现问题

用户在重复文件页点击“清理当前页”（批次 100 项），弹窗显示“已确认删除 0、确认失败 0、释放 0 B；第一批通信异常、处理结果未知；其后 146 项未提交”，内部错误“选中的视频符合大小与时长重复条件；请先核对候选，并在后台任务中单独确认删除”。

精确定位：此前两轮 UI 改造恢复了一次确认的单文件和本页批量入口，但实际还调用普通 `videoDelete`/`videoBatchDelete`。主进程中 `DuplicateCleanupRepository.assertGenericPermanentDeleteAllowed` 在**调用删除前**拒绝重复候选，因此该次报错**确定没有提交任何真实删除**。UI 把此确定性安全拦截误判成结果未知是错误的信息展示。

## 本地修复

- 新增正式 IPC `duplicate:reviewed-delete`，类型定义、preload 白名单和 main 处理器对齐。普通永久删除 IPC **仍禁止**删除重复候选；旧未核对的 `duplicate:fast-delete` **仍禁用**。
- 独立的 `reviewedDuplicateDelete.ts` 受控服务：
  - 只接收已明确选择的 `DuplicateResolvePlan`（保留 ID、待删 ID、分组），限额 1–100 个删除目标/批；
  - 主进程重新执行 `validateDuplicateResolvePlan`，检测保留和待删对象冲突、多目标重复及已有后台核对/删除任务预约；
  - 主进程复查两边的数据库版本、大小/修改时间/身份，判重仍按大小完全相等和四舍五入到整秒的时长一致，**不计算视频内容哈希**；
  - 本地普通文件在实际删除前逐项检查计划保留者仍是已启用来源内的可访问普通文件，待删对象调用 `permanentlyDeleteManagedFile` 的路径/符号链接/版本/身份/隔离/恢复保护；
  - 对检测为 CloudDrive 的来源，绝不因虚拟挂载根目录的 `realpath` 错误而放宽 Windows 文件系统校验；使用已绑定的 providerFileId/providerPath 和当前 CloudDrive 账号绑定，通过远端强制刷新核对保留与待删双方的远端 ID、路径、大小、修改时间，并在执行每次远端删除前再次读取确认；使用 CloudDrive gRPC 专用 API，每次只提交一个明确目标，绝不调用无确认的旧快速 API；
  - 云盘返回“移入回收站”时保留文件删除成功数量，但不计入物理释放字节并单独提示；若 API 无响应，标记当次结果未知，停止后续提交，未知项不可直接重试；防止同一远端路径被当作多个独立保留/删除目标。
  - 返回实际成功、明确失败及原因。安全预检被拒绝时返回**已确认失败**而不是笼统“通信中断，结果未知”；超时/调用断连则仍按结果未知处理，不自动重放。
- `LibraryShell` 在真实桌面版仅将新的受控删除回调传给重复页，不再将普通删除回调当作重复项快捷入口；普通库页仍保留其旧保护。
- `DuplicateGroupsPage` 单文件一次确认后调用受控 IPC；当前页按照 100 项构造子计划并保留每组指定保留项，经受控接口返回逐项成功/失败。普通删除 API 测试桩继续保留给组件回归，但不接入真实重复页。
- 将通用永久删除守卫原来的“时长毫秒完全相等”修正为“时长四舍五入到秒后相同”，确保与现有判重业务口径一致，防止时长相差数百毫秒的同组文件从普通删除绕开保护。

## 测试与安全边界

- 已在隔离临时文件夹执行真实永久删除测试：有效复制件删除且保留者仍存在；修改过的媒体被拒绝；保留项冲突被拒绝；已有任务占用被拒绝；普通删除 IPC 仍阻止整秒重复候选。测试不碰用户影片或真实 CloudDrive 文件。
- 新 UI 测试覆盖真实版优先走 `onReviewedDelete`，旧普通删除不应调用；不同批次必须带正确的 `keepVideoId`；后端明确拒绝不再写作“未知”。
- `npm run typecheck`（完成 CloudDrive 安全实现与 UI 修改后）：PASS。
- 聚焦回归：`tests/main/reviewedDuplicateDelete.test.ts`、`tests/renderer/DuplicateGroupsPage.test.tsx`、`tests/main/publicReleaseDeletionAdversarial.test.ts`、`tests/main/duplicateCleanupJobs.test.ts`，**104/104 PASS**。包含隔离本地删除、CloudDrive API mock 成功、身份变化拒绝、账号变化拒绝、云端回收站空间不计入、HTTP2 通信中断未知结果不重复提交、普通库安全拒绝保留、批量保留项校验和 UI 错误分类。
- 此前完整 `npm run test:node` 全套回归在完成最新远端加强代码之前执行：**1350/1354 PASS、4 项未通过**，未通过均在发行审批/证据门禁相关测试文件而非本次删除模块；发布审批资料仍不改动、不伪造批准。完整回归不是最新代码的全量放行证明。
- 只读核查用户真实资料库当前选定范围 3 个重复组、249 个成员，均为 `clouddrive` 已绑定 providerFileId/providerPath 且来源非只读；Windows 挂载根目录 `F:\\云下载` 对 `realpath` 返回 `UNKNOWN`，这证明普通 Windows 受管删除路径不适用于该数据源。**仅通过 mock CloudDrive API 单测覆盖新远端路径，真实用户影片绝不自动发远端删除请求。** 若远端修改时间与数据库记录有差异仍拒绝删除，需用户先刷新/扫描。
- 仅家里 PC `MP2T8QB5`，未推送 GitHub、未公开发版或更新线上文档。
- 修复前数据快照：`2026-10-21_02-14-56-432_duplicate-safe-reviewed-delete-repair`、checkpoint `checkpoint-20261021-101454-7002a44-duplicate-safe-reviewed-delete-repair`，SQLite 363528 条、quick_check=ok。
