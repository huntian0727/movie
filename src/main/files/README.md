# 文件操作模块

`fileOperations.ts` 提供保留扩展名的重命名、永久删除和无覆盖移动。普通重命名以排他方式创建新名称后才移除旧名称，不创建零字节占位文件，也不覆盖已有目标；Windows 仅大小写变更使用同目录 `.video-manager-rename-*.tmp` 两阶段重命名，第二阶段失败时恢复原名。数据库提交失败由 `commitRenameWithRollback` 恢复文件名。移动不使用“同大小即覆盖”：同名时生成数字后缀；同卷通过排他硬链接发布目标后才删除源，跨卷先写 `.video-manager-move-*.tmp`、复查源大小/mtime和复制大小，再排他发布。数据库提交失败由 `commitMoveWithRollback` 恢复原路径；回滚冲突时保留两份并上报。

IPC 先用 video id 从数据库获取受管路径，成功后才更新/删除数据库记录。不要改成接受 renderer 任意路径，也不要在磁盘失败时先改库。移动结果必须使用执行阶段重新规划出的最终路径，不能信任预览路径；永久删除不进入回收站，是最高风险交互。

需求定位：重命名、同名冲突、Windows 特殊名、删除失败或移动回滚先看本文件和 `src/main/ipc.ts`/repository。重命名错误码包括 `TARGET_EXISTS`、`FILE_LOCKED`、`PERMISSION_DENIED`、`SOURCE_NOT_FOUND`、`RENAME_FAILED`、`RENAME_ROLLBACK_FAILED`。`tests/main/fileOperations.test.ts` 覆盖普通/大小写重命名、失败无占位、数据库补偿、同名同大小移动、连续冲突、EXDEV、复制/发布/源删除失败和预览竞态；真实 ACL、杀毒软件锁定、跨卷、网络盘、符号链接仍需 Windows 手测。
