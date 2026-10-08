# 干净 Windows 11 验收

本轮当前主机装有开发工具且为 Insider，不能冒充干净 Windows 11。
Windows Sandbox 未安装；Hyper-V 查询遇到权限拒绝。未创建、启动或修改任何现有虚拟机。

使用全新稳定版 Windows 11 x64 VM 快照，不安装 Node/npm/Git。
仅复制已核验的 unsigned 安装包、build-metadata.json、build-flavor.json、SHA256SUMS.txt 和
`scripts/clean-windows11-acceptance.ps1`。此脚本无需 Node。

在该一次性 VM 的 PowerShell 中执行：

```powershell
.\clean-windows11-acceptance.ps1 -ArtifactDirectory 'C:\Acceptance\candidate' -DisposableMachineAcknowledged
```

脚本拒绝发现 PATH 中开发工具、已有测试身份或不匹配校验的情况；全部 SQLite/视频均为临时合成数据。
安装、实际 packaged create/verify、同版本修复及卸载均必须通过，未知文件和用户 SQLite 校验值保持不变。
证据保留于临时目录，不会自动删除。脚本 PASS 只表示这些自动项目通过。

随后在 VM 中进行正常交互验收：普通安装、首次启动、来源扫描、封面、图片浏览、搜索、播放、
双窗口同步、可选字幕/CloudDrive、错误恢复、退出后再次启动和从 Windows 应用页面卸载。
另用之前正式签名版的 VM 快照验证经审查的迁移方案；同版本修复不能替代跨版本升级。
记录系统版本、安装包哈希、截图、测试项/结果和操作者确认；不要使用真实账号和媒体。

将实际证据加入发布审批清单的哈希字段，才可讨论放行；此文档或尚未运行的脚本不能充当已通过证据。
