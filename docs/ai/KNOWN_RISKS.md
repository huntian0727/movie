# 已知风险与维护不变量

| 优先级 | 风险 | 不可破坏的不变量 | 修改后最低验证 |
| --- | --- | --- | --- |
| P0 | 永久删除/移动/重命名 | renderer 不提供可信路径；主进程按 id 反查并复查；不能先删目标再移动；失败可恢复或明确部分失败 | 文件操作单测、IPC 测试、真实 Windows 锁/ACL/跨卷手测 |
| P0 | 扫描误判缺失 | 根目录离线、子目录失败、超时或取消时，不用不完整枚举结果标记 missing | 增量/网络/异常重试测试，真实映射盘断线验证 |
| P0 | SQLite 升级 | 只追加 migration；升级前一致性备份；事务失败回滚；新版本不能被旧程序打开写入 | 全迁移链、旧库副本、恢复演练 |
| P0 | Electron IPC/协议 | sandbox/context isolation 保持开启；所有输入校验；按窗口角色校验 sender；路径不能任意穿透 | security、IPC contract、media protocol 测试和打包 smoke |
| P1 | 重复项误删 | 大小+时长只是候选规则；确认和实际删除前仍复查存在、大小、mtime；状态变化后旧计划作废 | duplicate safety/jobs 测试、真实网盘抽样播放 |
| P1 | 网络盘带宽与阻塞 | 页面查询只读 SQLite；FFprobe 单并发后台执行；目录调用有界且可取消；失败不破坏旧记录 | network/CloudDrive 测试、长阻塞和大目录 E2E |
| P1 | 缓存并发与磁盘 | 缓存始终可重建；只清专属目录；生成原子发布；清理后旧任务不能重新登记 | cache manager/service 测试、低磁盘/ACL 手测 |
| P1 | Node/Electron native ABI | Node Vitest 与 Electron 打包使用隔离工作树；不要在同一 checkout 来回 rebuild | release gate、Electron smoke、packaged smoke |
| P1 | 多窗口状态 | 主进程是权威；先订阅后快照；sequence 去重；成功后才发领域事件 | player window/renderer tests、真实双窗口高频操作 |
| P1 | 桌面交付指向旧包 | 影响桌面行为的提交必须重打包，核对 app.asar 与快捷方式目标，并从该快捷方式实启 | AGENTS.md 桌面交付清单 |

## 易被误解的产品语义

- 移除源目录只移除管理范围/索引，不删除磁盘视频；显式添加的更具体子目录继续保留。
- 重复项目录筛选展示的是“包含所选目录文件的完整重复组”，同组其他目录也会出现。
- 扫描异常不等于文件一定损坏；只有经过明确验证和确认后才能永久删除。
- 文件缺失使用软状态，临时离线磁盘不应造成资料库记录永久丢失。
- 历史 fingerprint 字段仍可能存在于 schema/兼容代码，但当前正式重复分组不使用内容指纹。

风险变化时应更新本文和对应测试，而不是只在聊天中说明。
