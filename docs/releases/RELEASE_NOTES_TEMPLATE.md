# 拉面影视 <VERSION> 发行说明（复制此模板）

> 相较于上一正式版 <PREVIOUS_VERSION>；技术包版本 <VERSION>；界面版本 <DISPLAY_VERSION>。发行范围：Windows x64 免安装绿色 ZIP、未签名；不是 NSIS 安装器。下述条目只记录**此版本实际交付**的功能。

## 安全类
- <实际安全/防误删改进；没有则写“本版无此类变更”>

## 性能类
- <实际性能/后台操作改进；没有则写“本版无此类变更”>

## 功能增加类
- <新增或变化的功能；没有则写“本版无此类变更”>

## 修复与体验
- <其他已完成的缺陷和易用性修改；可选>

## 下载与升级
- 程序：`Movie-<VERSION>-Windows-x64-Portable.zip`
- 发行页面：`https://github.com/huntian0727/movie/releases/tag/v<VERSION>`
- 使用文档：`docs/user-guide/<VERSION>.md`
- 使用前请备份资料库；新绿色 ZIP 解压到独立目录，避免覆盖正在运行的程序。
- 未签名可能触发 Windows 未知发布者提示；不要求关闭安全防护。

## 验证与边界
- Git commit：<EXACT_SHA>
- Windows CI / 安全检查：<EXACT_RUN_IDS_AND_RESULT>
- ZIP SHA-256：<EXACT_HASH>
- 对应应用源码 / 原生源码 / SOURCE-PAIR / SHA256SUMS / RELEASE-VERIFICATION：<是否齐全>
- 人工体验：<实际完成项或 NOT RUN>
- 未覆盖场景：<例如稳定 Windows/标准用户认证、真实网盘破坏性删除是否执行>
