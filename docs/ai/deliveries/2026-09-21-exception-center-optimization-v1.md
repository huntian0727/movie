# 映匣异常中心分析与性能优化 V1

## Context

分支：`ai/exception-center-optimization-v1`。本轮在不重写扫描器、不增加视频内容读取、不改变文件删除边界的前提下，优化异常中心的分类准确性、查询成本、状态收敛和大规模来源异常展示。

## Changes

- 扫描失败分类优先使用结构化 `error_code`：明确区分不存在、网络超时、权限、占用等状态；旧记录继续兼容错误摘要规则。
- 扫描失败分页改为 JOIN 获取视频标识并批量加载视频，消除页面内逐条 `getVideoByPath` 查询。
- 新增去重后的 `healthIssueCount`：同一视频的缺失、元数据异常和多阶段扫描失败只计为一个健康事件；离线来源的重复扫描失败折叠为一个来源级事件。
- 异常中心侧栏改用去重后的健康事件数，不再简单累加三个标签页记录数。
- 扫描失败页面新增默认折叠的来源级异常摘要，可一键限定到对应资料库。
- 文件恢复或版本刷新成功后，自动关闭同一文件仍未解决的旧扫描失败记录。
- 元数据异常的重复大小判断改为利用现有 `size_bytes` 索引执行按需 peer 查询，避免每次列表与统计都先构建全库重复大小集合。
- 已确认现有 IPC 会注入真实元数据队列状态，未重复新增队列接口。

明确未修改：

- Directory Snapshot 与 ScanManager 扫描架构
- FFprobe 调度与播放器核心逻辑
- 数据库结构和迁移版本
- CloudDrive 批量确认安全边界
- 永久删除和重复项 SHA-256 发布门禁

## Verification

- TypeScript 类型检查：PASS。
- 完整 Node 测试：72 个测试文件、666 项测试全部通过。
- 新增回归覆盖：结构化错误码优先、扫描失败批量关联、跨状态健康事件去重、离线来源折叠、恢复后自动关闭异常、来源摘要交互。
- 32 万条数据性能门禁：
  - Library overview worker：约 978 ms，事件循环保持响应。
  - Metadata issues（32 万视频、5 千失败）：约 601 ms，2 条 SQL。
  - Asset Center（32 万视频、100 来源）：约 1557 ms，1 条 SQL。
- Production build：PASS。
- Windows `win-unpacked` 与 NSIS 安装包：PASS。
- ASAR 制品检查：3982 个条目，无禁入开发文件。
- Packaged smoke：PASS。
- Installer smoke：PASS。
- NSIS 静默覆盖安装：退出码 0。
- release 与正式安装的 `resources/app.asar` SHA-256 一致：`48e5420c61b2d5292dc6251aecd20acb11e6e7c545bb85d6b9125f37dfb1b8c8`。

## Risks and follow-up

- 来源级摘要当前使用资料库已有 `scanError` 状态，不会在打开异常中心时主动访问来源。
- 历史异常若没有可靠错误码仍需使用保守的错误摘要兼容规则；新记录应继续提高标准错误码覆盖率。
- 健康事件数表示去重后的受影响对象数，各标签页仍显示自己的原始记录数，二者语义不同。
- 安装包为未签名测试构建，正式对外发布仍需代码签名。
