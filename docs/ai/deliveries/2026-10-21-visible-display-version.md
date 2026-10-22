# 拉面影视两段式可见版本号（本地交付）

- 日期：2026-10-21（北京时间）
- 开发分支：`ai/visible-display-version`
- 源码基线：`3b526f7`（后台重复文件清理已上线本机日常版）
- 本次界面版本：`v1.1`（独立两段式版本体系首次建立；以既有版本为逻辑 `v1.0` 基准，此次小更新到 `v1.1`）
- 开发设备：家用 PC `MP2T8QB5`；**禁止使用办公电脑**
- GitHub：当前用户明确要求暂时不 push、不公开发版、不更新在线发行文档，直到另行授权
- 基线备份：`2026-10-21_05-38-29-323_visible-display-version`；数据库 `quick_check=ok`，363227 条视频，0.92 GB；本地 checkpoint `checkpoint-20261021-133827-3b526f7-visible-display-version`

## 用户要求

1. 左上角应用名“拉面影视”后直接显示显眼而不过度突出的两段式版本号；
2. 大更新增加第一段、第二段归零（如 `1.27 → 2.0`）；
3. 普通小更新只增加第二段、范围为 0～999（如 `1.27 → 1.28`）；
4. 每次用户可感知开发任务完成后实际交付新版本，并告知用户版本及对应 Git Commit，避免一直打开旧版；
5. 不改变既有内部 SemVer/冻结发行批准资料 `0.1.16`。

## 实施

- `src/shared/displayVersion.json` 记录唯一 `{major:1,minor:1}`；
- `src/renderer/components/LibraryShell.tsx` + `src/renderer/styles.css` 左侧品牌标题后显示 `v1.1`；从源 JSON 在构建期导入，离线可用；
- `scripts/display-version.mjs` 校验、格式化、边界版本推进及防止版本复用；`scripts/bump-display-version.mjs` 提供两个明确命令，避免仅因重复跑测试/打包而默默加版本；
- `package.json` 增加 `npm run version:minor` 与 `npm run version:major`；
- `scripts/package-development.mjs` 将同一版本写入最终 `resources/build-flavor.json.displayVersion`。检查既有 `release/win-unpacked`：若 Git 提交不同却沿用相同的可见版本，阻止日常打包；若降低版本同样阻止。旧包没有 `displayVersion` 时允许首次升级；
- `scripts/run-electron-builder.mjs` 对未来公开候选的 build flavor 也附加同一 `displayVersion`，但未运行任何正式发行打包或改动已批准的发行版本；
- `AGENTS.md`、`docs/DEVELOPMENT_AND_RELEASE.md` 将每次开发完成后递增界面版本、打包确认及最终报告的义务写成以后 AI 开发固定规则；
- `CHANGELOG.md`、`docs/USER_GUIDE.md` 标注尚未公开的变动；
- `tests/scripts/displayVersion.test.mjs` 与 `tests/renderer/LibraryShell.test.tsx` 增加合法范围、升级策略、防版本复用、已存在品牌 UI 的可见版本测试。

## 验证

- `npm run typecheck` PASS；
- `vitest run tests/scripts/displayVersion.test.mjs tests/renderer/LibraryShell.test.tsx tests/main/ipcContracts.test.ts`：3 个文件，**87/87 PASS**。
- 完整 `npm run test:node` 已运行完毕：148 个测试文件中 146 通过、2 个发行审批相关失败；**1379/1382 测试通过，3 项失败**，均为先前发行批准文件绑定的 `0.1.15` 与当前 `package.json` `0.1.16` 以及 `package-lock.json` 校验哈希不一致。没有修改审批记录或把失败算成通过；本轮新增版本号相关测试均通过。
- 本地桌面构建、最终快捷方式从新程序启动和构建版本核对：以最后实测结果补充，不能预先标记 PASS。
- 不触碰任何真实用户影片或删除队列；不中断后台清理任务的前提下进行桌面部署（如果有真实任务正在执行，应等待任务结束）。
