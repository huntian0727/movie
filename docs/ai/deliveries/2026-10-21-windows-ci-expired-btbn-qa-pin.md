---
date: 2026-10-21
branch: ai/native-runtime-candidate-integration
type: release-ci-reliability
status: partial
---

# Windows CI 旧 BtbN QA 下载过期修复

## Context

GitHub Draft PR #29 (https://github.com/huntian0727/movie/pull/29) 的 Windows CI run 39627833290 (https://github.com/huntian0727/movie/actions/runs/39627833290) 中，Node job 在执行 npm run test:release-gate 的第一个 prepare:media-tools 步骤时失败。HTTP 404 URL：

https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-05-13-07/ffmpeg-n9.0.2-22-g46d8f462ee-win64-lgpl-9.0.zip

原因是 scripts/native-media-candidate.lock.json 锁定了已清理的每日构建发行标签。不是代码单测失败，不能声称旧的 Windows CI 全通过。

## Changes

- .github/workflows/windows-ci.yml 的 node-tests 与 unsigned-installation-qa 两个 job 固定环境变量 MOVIE_MEDIA_VARIANT=lite-candidate。所有原本的测试步骤、npm run test:release-gate、构建/解压/安装/卸载门禁均保留，未删除、跳过或放宽断言。
- 此选项对应现有 scripts/native-media-lite.lock.json，固定的 serversideup/ffmpeg-lgpl-builds v8.1.2-27 Windows x64 LGPL QA 输入。上游固定资产 HTTP 200，原 SHA-256 fb2de01912edb449a5eba1cc487696c7f71ebb7b325e5c5c69434642ec2ba6b0；本机重新核对 13/13 文件哈希，ffmpeg.exe SHA dd2ae91c672ecc7d9233a7ed075dc9437aa817cfb68dce66b172bd61e25cbbe4，ffprobe.exe SHA 57dec3db58729d5f00794bf65d76f15f9278c457989e4a649a02063abdd19bc8。
- 正式原生候选依旧为 source-candidate；本修复不替换/降级正式候选，也不修改两个 source lock。
- Lite 输入仍为 CANDIDATE_NOT_APPROVED 与 distributable=false；CI 只上传无二进制的 QA 验证元数据，不能当成 0.1.16 的公开发行批准。

## Verification

- 固定发行 URL：HTTP 200；MOVIE_MEDIA_VARIANT=lite-candidate npm run prepare:media-tools：PASS，13/13 哈希校验。
- MOVIE_MEDIA_VARIANT=lite-candidate npm run test:release-gate：2026-10-22 本机全量 PASS，退出码 0；保留全部原质量检查。
- 倍速回归：旧测试把 4× 当作非法值，与 v1.5 已支持的 3×/4×/5× 冲突。将拒绝值改为 6× 后，tests/main/embeddedPauseConfirmation.test.ts 15/15 PASS，随后完整发布质量门禁 PASS。
- 推送后需在 GitHub Draft PR #29 上确认最终 HEAD 的 Windows Node、Electron、依赖、NSIS 隔离 QA 和安全审计真实状态；CI 通过不能批准公开发行。
- 未改动 Windows 日常桌面版、真实 SQLite 或媒体文件，未进行 CloudDrive/115 删除。

## Risks and follow-up

- GitHub CI 尚未在本次最终提交上重跑；当前状态只证明本机门禁通过。
- 正式候选的原生来源、许可审批、人工播放验收仍按现有发行门禁处理；不创建 tag、不发布 GitHub Release。
- 本修复是 QA 工作流依赖固定，不改变正式 source-candidate 的依赖锁、审批文件或分发状态。
