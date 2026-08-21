# TASK-SAFETY-001 UI review handoff

- Reviewer: UI/UX Designer Agent
- Date: 2026-08-16
- Verdict: `UI_REVIEW_FAILED`
- Review mode: read-only production-code, CSS, and renderer-test review
- Design source: `.agent/handoffs/TASK-SAFETY-001-ui-design.md`

## Executive conclusion

The implementation has the correct safety-flow skeleton: opening the preflight does not begin file reads; verification has three result states; permanent deletion uses a separate exact-`DELETE` alertdialog; validation cancellation and deletion stopping use different actions; and resume/retry starts a new full verification. However, two release-gate UI requirements are still violated in the user-visible implementation:

1. Metadata-only candidates are still presented as already known duplicates and already selected for deletion.
2. The new destructive workflow has no guaranteed visible keyboard focus treatment.

Because candidate wording is part of the deletion-safety contract, this is a UI Gate failure rather than polish. A focused UI rework is sufficient; this does not require a large redesign or Web Advisor-led visual overhaul.

## Gate results

### Blockers

1. **Candidate stage prematurely promises duplication/deletion — FAIL.**
   - `src/renderer/components/DuplicateGroupsPage.tsx:470-483` shows `重复组`, `拟删除`, and `待删除` before full SHA-256 verification.
   - `src/renderer/components/DuplicateGroupsPage.tsx:247` and `:255` use `预计可释放`; the approved handoff requires `候选可释放空间`.
   - `src/renderer/components/DuplicateCleanupButton.tsx:47` reports `待删文件` immediately after verification is merely queued.
   - `src/renderer/components/DuplicateCleanupButton.tsx:61-65` gives the read-only `验证当前页` opener the destructive `danger` treatment; `src/renderer/styles.css:288` renders that treatment red. Red is reserved for the irreversible deletion action.
   - `tests/renderer/DuplicateGroupsPage.test.tsx:29` positively asserts `重复组 01`, and no renderer test asserts that candidate UI excludes `待删除`/`拟删除`.
   - Required replacement: `候选组`, `候选项`, `计划保留`, `候选移除`, `候选可释放空间`; do not use `重复`, `相同`, `待删除`, or `拟删除` as a result claim before verification.

2. **Visible keyboard focus — FAIL.**
   - `src/renderer/styles.css:95`, `:109`, `:117`, `:128`, and `:198` define local focus styles for older controls, but the new dialog buttons/input/task rows have no shared `:focus-visible` rule.
   - This violates the handoff requirement that every button, input, and link in the safety flow has an obvious visible focus state.

### Implemented correctly

- **Preflight does not begin file reads — PASS by component contract/test.** `DuplicateCleanupButton` calls `onSubmitCleanup` only from `开始完整验证`; `tests/renderer/DuplicateGroupsPage.test.tsx:37-41` checks that opening the preflight alone makes no submission call. This is renderer-contract evidence, not a filesystem-I/O trace.
- **Preflight modal keyboard behavior — PASS.** Initial focus, Tab containment, Escape close, and opener focus restoration are implemented and covered in `DuplicateGroupsPage.test.tsx:49-60`.
- **Verification/result tri-state — PASS.** `DuplicateCleanupTasksPanel.tsx:114` renders per-item outcomes; the labels distinguish full-hash match, content difference, and unverifiable/cancelled, with non-match states explicitly marked no-delete. Renderer coverage exists in `DuplicateCleanupTasksPanel.test.tsx`.
- **Independent exact-`DELETE` alertdialog — PASS.** `DuplicateCleanupTasksPanel.tsx:107` opens a nested confirmation and `:126-134` requires exact, case-sensitive, untrimmed `DELETE`; the destructive button is not initially focused. Tests cover invalid spellings, input focus, Escape, and restoration to the confirmation trigger (`DuplicateCleanupTasksPanel.test.tsx:53-83`).
- **Cancel validation vs stop remaining deletion — PARTIAL.** The action labels correctly change at `DuplicateCleanupTasksPanel.tsx:108`, and tests assert both labels (`DuplicateCleanupTasksPanel.test.tsx:89-91`). Missing explanatory copy remains: validation cancellation must promise zero deletion while waiting for safe read stop; deletion stop must say completed permanent deletions cannot be undone and only not-yet-started items are stopped.
- **Resume/retry revalidates — PASS in visible action wording.** Both controls say `重新完整验证` at `DuplicateCleanupTasksPanel.tsx:109-110`; test coverage exists at `DuplicateCleanupTasksPanel.test.tsx:97`. Backend enforcement remains covered by engineering/QA gates rather than this UI review.

### Required follow-up, non-blocking only after the two blockers are fixed

1. **Second confirmation needs the full authorization summary.** `DuplicateCleanupTasksPanel.tsx:126-127` shows the verified-identical deletion count but omits keep count/group count/reclaimable bytes and the final path-size-mtime recheck promise.
2. **Version-change and isolation-recovery copy is not a stable renderer state.** `DuplicateCleanupTasksPanel.tsx:114` appends raw `item.message`; add mapped, user-facing states such as `文件版本已变化，已阻止删除。请重新进行完整内容验证。` and `隔离恢复完成；原删除授权已失效，请重新完整验证。`, with renderer tests.
3. **Task-center opener focus is not restored.** Nested confirmation focus restoration passes, but closing the outer task-center dialog does not return focus to the exact control that opened it. Add an opener ref/return-focus contract and test Escape, close button, and backdrop close.
4. **Progress accessibility is incomplete.** `DuplicateCleanupTasksPanel.tsx:95` renders `<progress>` without an explicit accessible name, and the workflow has no throttled `aria-live="polite"` progress/cancellation acknowledgement. Do not announce byte-level updates.
5. **CSS tokens are unresolved.** `src/renderer/styles.css:544`, `:546`, and `:550` reference `--border-color`/`--accent`, but this stylesheet does not define those tokens. Use established local tokens or define them at the theme root.
6. **Reduced motion is not handled.** Add a `prefers-reduced-motion: reduce` override for verification spinners/transition effects.

## 900 px and visual-review boundary

- Static layout review finds no obvious structural break at a 900 px window: `src/renderer/styles.css:540-543` gives the task center `92vw` width and a two-column `minmax(280px, 38%) 1fr` grid; the single-column breakpoint is 760 px. At 900 px, the grid has enough nominal width for both columns.
- This is not a pixel-level visual pass. The repository contains no applicable screenshots, and launching the normal local application could scan or write the user's real video library. I therefore did not launch it. The reported Electron smoke test is behavioral, not visual. A final release gate should capture the isolated fixture app at 900 px and verify no clipping, obscured actions, or horizontal overflow.

## Test evidence

Focused command run on 2026-08-16:

`npx vitest run tests/renderer/DuplicateGroupsPage.test.tsx tests/renderer/DuplicateCleanupTasksPanel.test.tsx`

- 2 test files passed
- 27 tests passed
- Vitest emitted React `act(...)` warnings in four task-panel tests. They do not change the current verdict, but should be cleaned up so asynchronous UI regressions are not hidden by noisy output.

Independent QA evidence accepted from the task packet: 46 files / 459 tests passed and isolated Electron smoke passed, with SMB/mapped-drive coverage still listed as a known risk.

## Minimum developer rework

1. Replace all premature candidate/deletion-result language and remove the red danger style from `验证当前页`.
2. Add a common visible `:focus-visible` treatment for all controls in both dialogs and task center.
3. Add renderer tests that fail if the candidate page contains `待删除`, `拟删除`, or result-claiming `重复组` before verification.
4. Add stable UI copy/tests for cancellation semantics, final version recheck blocking, and isolation-recovery authorization invalidation.
5. Restore focus to the exact task-center opener; label progress and add throttled live announcements.
6. Re-run the focused tests and perform an isolated 900 px screenshot check.

## Next UI task

After Developer rework, rerun this review as `TASK-SAFETY-001 UI_REVIEW 2`. Expected disposition is `UI_REVIEW_PASS` once the two blocking gates and the safety-copy/focus requirements above are evidenced. No large UI redesign is recommended.
