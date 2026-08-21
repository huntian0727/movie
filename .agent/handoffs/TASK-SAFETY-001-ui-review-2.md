# TASK-SAFETY-001 UI review 2 handoff

- Reviewer: UI/UX Designer Agent
- Date: 2026-08-16
- Verdict: `UI_REVIEW_FAILED`
- Review mode: read-only production-code, CSS, renderer-test, and isolated-layout evidence review
- Compared against: `.agent/handoffs/TASK-SAFETY-001-ui-review.md`

## Executive conclusion

Developer UI REWORK 2 closes both original blockers and almost every listed follow-up. Candidate discovery now uses candidate language, validation actions are non-destructive in color, the safety workflow has visible keyboard focus, modal focus restoration works, cancellation semantics are explicit, progress is accessible, CSS tokens resolve, reduced motion is handled, and the focused test suite is clean.

One narrow safety-copy gap remains. Two reachable deletion-stage outcome codes fall through to raw backend messages instead of stable Chinese no-delete and authorization-invalidated guidance. The affected row still leads with `完整哈希相同`, so the user is not given a reliable deletion outcome. This is directly within the requested stable isolation and cancellation-result mapping gate, so the review remains failed. No layout redesign is needed.

## Review 1 gate closure

### Original blocker 1: candidate semantics and non-red validation

`PASS`

- `src/renderer/components/DuplicateGroupsPage.tsx:470-483` now uses `候选组`, `候选移除`, `候选可释放空间`, and `计划保留`.
- `src/renderer/components/DuplicateCleanupButton.tsx:47` uses `候选移除文件` and `计划保留文件` when verification is accepted.
- `src/renderer/components/DuplicateCleanupButton.tsx:62` uses `verification-action`, not `danger`.
- `src/renderer/styles.css:292-295` gives validation controls the blue workflow accent. Red remains reserved for the final irreversible action.
- `tests/renderer/DuplicateGroupsPage.test.tsx:37-61` positively checks candidate wording and rejects `重复组`, `拟删除`, `待删除`, `预计可释放`, and `待删文件` in the rendered candidate workflow.

### Original blocker 2: visible keyboard focus

`PASS`

- `src/renderer/styles.css:566-572` provides a 3 px high-contrast `:focus-visible` outline for buttons, inputs, selects, links, and task rows in the duplicate workflow.
- The nested confirmation is inside `.task-center-backdrop`, so the same treatment covers the exact-`DELETE` input and both confirmation buttons.
- `tests/renderer/duplicateSafetyStyles.test.ts:8-13` protects the focus rule and workflow color.

## Follow-up gate results

### Exact task-center opener restoration

`PASS`

- `DuplicateGroupsPage` holds the active task-center opener in `taskCenterOpenerRef` and passes it as `returnFocusRef`.
- `DuplicateCleanupTasksPanel.tsx:79-83` restores that element after outer close.
- `tests/renderer/DuplicateGroupsPage.test.tsx:167-181` covers Escape, header-close, and backdrop-close paths and checks the exact opener receives focus.
- The independent exact-`DELETE` alertdialog still restores focus to its own trigger after Escape or cancel.

### Cancel validation versus stop remaining deletion

`PASS` for active-state copy; terminal mapping has the separate blocker below.

- `DuplicateCleanupTasksPanel.tsx:124-125` states that validation cancellation waits for a safe read stop and deletes nothing, while deletion stopping affects only items not yet started and cannot undo completed permanent deletions.
- The action at `DuplicateCleanupTasksPanel.tsx:129` switches between `取消验证` and `停止剩余删除`.
- Renderer assertions are at `tests/renderer/DuplicateCleanupTasksPanel.test.tsx:89-93`.

### Stable version, isolation, and authorization guidance

`FAIL`, one narrow blocker.

- Correct mappings exist for integrity/version changes, `isolation-recovery-required`, and `authorization-rejected` at `DuplicateCleanupTasksPanel.tsx:172-181`.
- The main service can also produce `isolation-failed` at `src/main/media/duplicateCleanupService.ts:271` and `delete-stop-requested` at `:285`.
- Neither code is mapped. `DuplicateCleanupTasksPanel.tsx:182` therefore exposes the raw backend message.
- The row renderer at `DuplicateCleanupTasksPanel.tsx:134` leads with the verification result rather than deletion status. A failed item can consequently read `完整哈希相同 · Could not isolate the authorized target...`, without stable `未执行删除` or `原删除授权已失效` guidance.
- Existing renderer coverage at `DuplicateCleanupTasksPanel.test.tsx:176-197` covers version change and recovery-required only. It does not cover the two reachable codes above.

Required minimum correction:

1. Map `isolation-failed` to stable user copy that explicitly says safe isolation failed, no deletion occurred, authorization is invalid, and a new full verification is required after the file issue is resolved.
2. Map `delete-stop-requested` to stable terminal copy that explicitly says this item was not permanently deleted. If a staged recovery path exists, state that recovery must be resolved before revalidation; otherwise state that any later cleanup requires a new full verification.
3. Audit adjacent reachable deletion-stage outcome codes once and ensure every code either has a stable outcome mapping or a safe generic prefix that distinguishes `已删除`, `未删除`, and `需要恢复` before optional technical details.
4. Add renderer tests that feed `isolation-failed` and both restored/unrestored `delete-stop-requested` items, reject raw English messages, and assert the no-delete and authorization-invalidated guidance.

### Progress accessibility and throttled announcements

`PASS`

- `DuplicateCleanupTasksPanel.tsx:115` gives each `<progress>` element a phase-specific accessible name.
- `DuplicateCleanupTasksPanel.tsx:52-59` throttles item-level status updates by 500 ms and cleans up the timer.
- `DuplicateCleanupTasksPanel.tsx:107` exposes the update through an atomic polite live region.
- `tests/renderer/DuplicateCleanupTasksPanel.test.tsx:200-210` covers the progress name and live update.

### CSS tokens and reduced motion

`PASS`

- `src/renderer/styles.css:2-4` defines the workflow border and accent tokens.
- No `var(--accent)` reference remains in the task-center rules.
- `src/renderer/styles.css:585-588` disables workflow animation and collapses transition duration under `prefers-reduced-motion: reduce`.
- `tests/renderer/duplicateSafetyStyles.test.ts:15-26` covers both requirements.

### 900 px isolated layout gate

`PASS` for current local acceptance, with a known visual-evidence gap.

- `src/renderer/styles.css:547-550` uses a `92vw` task-center and `minmax(280px, 38%) 1fr` grid; `box-sizing: border-box` is global and the layout collapses at 760 px.
- At a 900 px viewport, the nominal dialog width is 828 px and leaves approximately 788 px of content width after padding, enough for the 299 px first column, 16 px gap, and remaining detail column.
- `tests/renderer/DuplicateGroupsPage.test.tsx:183-193` confirms both task-center regions and the close action remain present in the isolated 900 px fixture DOM.
- `tests/renderer/duplicateSafetyStyles.test.ts:15-22` protects width, grid, token, and breakpoint rules.
- This is not a screenshot or computed-layout test. No safe fixture-app screenshot route was available, and launching the normal app could touch the user's real library. The missing screenshot is non-blocking for current local acceptance because the static geometry and isolated DOM gate agree. It remains a visual release-evidence gap for clipping, wrapping, and pixel-level focus-ring inspection.

### Exact DELETE confirmation and authorization summary

`PASS`

- The confirmation remains an independent `role="alertdialog"` requiring exact case-sensitive, untrimmed `DELETE`.
- `DuplicateCleanupTasksPanel.tsx:146-151` includes candidate-group count, maximum keep count, verified-identical removal count, candidate reclaimable upper bound, final hash/identity/size/mtime recheck, and irreversibility.
- Only `永久删除已验证相同项` receives the red `danger` treatment.

## Test evidence

Focused command rerun on 2026-08-16:

`npx vitest run tests/renderer/DuplicateGroupsPage.test.tsx tests/renderer/DuplicateCleanupTasksPanel.test.tsx tests/renderer/duplicateSafetyStyles.test.ts tests/renderer/LibraryShell.test.tsx`

- 4 test files passed
- 80 tests passed
- No React `act(...)` warning appeared

Accepted independent QA evidence:

- Backend safety regression: 33/33 passed
- UI and LibraryShell: 80/80 passed
- Verdict: `PASS_WITH_KNOWN_RISKS`
- Real mapped/offline SMB behavior remains unavailable on this host

## Required next UI task

Route a narrowly scoped `TASK-SAFETY-001 UI REWORK 3` to Developer Agent. Change only deletion-result presentation and renderer coverage for `isolation-failed`, `delete-stop-requested`, and adjacent reachable outcome codes. After focused QA, UI/UX Designer reruns `UI_REVIEW 3`. No Web Advisor or large UI redesign is needed.
