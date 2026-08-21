# Task Packet

- Task ID: TASK-WORKFLOW-001
- Title: Risk-Based Low-Token Agent Workflow
- Workflow: STANDARD
- Risk Areas: AGENT_INFRA / TOOLING / DOCUMENTATION
- QA Required: YES
- UI Required: NO
- Web Advisor Required: NO
- Workflow Reason: 仅调整协作规则、状态与验证脚本，不触碰业务或用户数据；脚本和跨角色契约需要独立、聚焦验证。
- Owner: Local Project Manager → Developer
- User Goal: 按风险动态调度角色，减少重复读取、重复报告和确定性事实的 LLM 消耗。
- Scope: LITE/STANDARD/FULL 选择器、按需上下文、短 JSON handoff、机器状态、Git/测试脚本、三类模拟和最小文档更新。
- Out of Scope: 播放、永久删除、UI、扫描、CloudDrive、数据库及其他业务开发。
- Acceptance: 三个模拟分别得到 LITE/Developer、STANDARD/Developer+QA、FULL/Developer+QA+严格 gate；风险可升级且仅 PM 可降级；成功短、失败详；确定性状态可脚本复现。
- Automated Tests: agent script tests、PowerShell AST、skill validation、workflow simulations、git diff check。
- Status: VERIFIED
- Closeout: 2026-08-21 PM 行政关闭。Developer/QA gate 均 PASS（47 files/479 tests；QA focused 11/11），不重跑业务门禁。新工作模型已经在 TASK-CLOUD-001 上启用。
- Next Actor: none
