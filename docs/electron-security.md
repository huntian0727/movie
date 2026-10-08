# Electron 安全边界

本文记录窗口、导航、preload 和 IPC 的信任模型。修改 BrowserWindow、入口 URL、preload API 或 IPC channel 时必须同步阅读 `src/main/security.ts`、本文件和安全测试。

## 威胁模型

renderer 不能提供任意主进程文件路径或取得 Node 权限。未登记页面、错误角色、子 frame 和意外导航不能调用 IPC。
但如果已授权主窗口本身被 XSS 或供应链代码攻陷，攻击代码能调用该角色已有的 bridge；入口信任检查不是用户意图证明。
高风险删除的公众确认策略仍待所有者决定，不能据此宣称合法主窗口中的恶意代码绝无破坏能力。

安全边界分为四层：

1. 生产页面由严格 CSP 限制脚本、连接、媒体和对象来源。
2. 生产入口固定 `app-ui://bundle/index.html`，协议只服务 dist-renderer 构建资产并拒绝穿越、符号链接和未知资源；不使用宽泛 `file:` 同源。
   每个窗口的协议、hostname、port 和入口路径必须一致，不能把自定义协议的 `null` origin 当作同源证明。
3. preload 只有在当前页面与主进程传入的入口 URL 一致时才暴露 bridge，并按窗口角色缩减 API。
4. IPC 主进程重新校验 WebContents ID、登记角色、顶层 senderFrame、frame 存活状态和当前 URL。renderer 传入的角色或路径不可信。

## 窗口角色与能力

| 角色 | 主要用途 | 允许的写操作 |
| --- | --- | --- |
| `main` | 资料库主窗口 | 现有全部经过 schema/仓储复核的业务操作 |
| `player` | 独立播放窗口 | 单视频收藏、待删除标记、单视频删除、外部播放和播放历史 |
| `smoke` | 打包后自动验证窗口 | 不允许 IPC；仅验证 preload 表面、CSP、导航和新窗口策略 |
| `timeline-preview` | 浮动时间轴图像预览 | 仅图像预览 IPC |

播放器 preload 不暴露批量删除、重复项清理、移动、重命名、目录管理、设置写入或清缓存。即使页面伪造 preload 角色，主进程仍以登记的 WebContents 角色为准。

所有 channel 都经过统一 wrapper。未登记窗口、子 frame、销毁 frame、URL 不匹配或角色无权限时抛出稳定前缀：

```text
ERR_UNTRUSTED_IPC_SENDER
```

安全拒绝日志只记录角色以及脱敏后的协议/origin；`file:` 路径、URL path、query 和本地视频路径不得进入该日志。已有结构化持久日志采用脱敏白名单。

## CSP

生产策略的 `script-src` 只有 `'self'`，不包含 `unsafe-inline`、`unsafe-eval`、`data:` 或远程 HTTP 源。`local-video:` 仅用于必要的图片、媒体和连接；`object-src`、`base-uri`、`form-action`、`frame-ancestors` 均为 `none`。

开发策略单独生成。Vite React refresh 需要开发期 inline module，因此开发 `script-src` 包含 `unsafe-inline`，但仍不包含 `unsafe-eval`；HMR 连接只允许配置的开发 origin 和对应 WebSocket origin。不能把开发放宽项复制到生产策略。

## 导航与外链

- `will-navigate` 只接受当前窗口登记的入口。
- `setWindowOpenHandler` 一律 `deny`。
- 主进程仅对枚举的字幕提供方固定官网执行 `shell.openExternal`；不接受 Renderer 提供的任意 URL。
- 将来如增加帮助链接，只能在主进程对固定 `https:` host 白名单校验后打开；不能接受 renderer 提供的任意 URL。

## 修改映射

| 自然语言需求 | 首查范围 |
| --- | --- |
| 增加新窗口或独立工具页 | `security.ts`、窗口创建文件、preload 角色、packaged smoke |
| 播放器需要新的主进程能力 | `getAllowedIpcRoles`、player preload API、IPC schema、角色差异测试 |
| 增加删除/移动/设置类 IPC | IPC schema、统一 wrapper、main/player 权限、文件/数据库回滚测试 |
| 开发服务器或资源来源变化 | production/development CSP、入口 URL 比较、打包后 CSP smoke |
| 需要打开官网/帮助页 | 新增严格 HTTPS host 白名单和测试；保持 `window.open` 默认拒绝 |

## 验证

- `tests/main/security.test.ts`：CSP、可信 URL、导航、新窗口、伪造 frame、窗口角色和 destructive handler wrapper。
- `npm run test:packaged-smoke`：在真实 packaged renderer 中注入 inline/data script，尝试外部导航和 `window.open`，检查播放器 bridge 最小化，并用未受保护的测试窗口证明非入口页面拿不到 bridge。
- `npm run test:electron-smoke`：Electron ABI 与主进程启动基线。
- `npm run test:renderer-security-smoke`：真实 Electron 的三种窗口、合法资产/媒体、外部本地文件/脚本、网络拒绝与 DPAPI 恢复。

自定义媒体响应 CORS 只允许准确的可信 Renderer origin。真实请求同时依据 WebContents/frame/initiatorOrigin 授权，
不能依赖 protocol.handle 中可能缺失的 Origin/referrer。opaque/null-origin 页面在进入媒体服务前拒绝。
摄像头、麦克风和其他不需要的会话权限默认拒绝。

主进程签发的单次确认 token 尚未实现；不同删除入口的确认流程并不相同。
通用及数据表删除会重新查数据库 ID、启用来源、当前对象版本和 reparse 边界；快速 CloudDrive 重复清理跳过全文哈希和二次确认，
旧本地完整哈希流程还有隐藏自动确认兼容路径。详见发布审计与集中待决事项。
