# Agent Handoff

- Task ID: TASK-SAFETY-001
- From: UI/UX Designer Agent
- To: Local Project Manager
- Status: UI_DESIGN_COMPLETE
- Branch: `ai/duplicate-sha256-safety`
- SHA: `2bc1359975fc6098dd8663043f00a36cb6203ab0`
- Changed Files: `.agent/handoffs/TASK-SAFETY-001-ui-design.md`
- Evidence: Inspected the current duplicate candidate page, foreground preflight and confirmation flow, background cleanup task center, duplicate-page styles, renderer tests, the active task packet, and the approved staged-verification decision.
- Risks: Current UI calls metadata candidates "重复组" and marks files "待删除" before byte verification; the primary action says "清理当前页"; current confirmation explicitly says content was not compared; single-item delete, background resume, and retry actions can appear to bypass full SHA-256 verification; validation cancellation and deletion-stop semantics are not distinguished.
- Requested Action: Implement the staged interaction contract below without changing the surrounding library information architecture.
- Next Actor: Local Project Manager routes this handoff to Developer Agent.

## 1. Product promise and UI invariant

The duplicate page discovers candidates using cached low-bandwidth metadata only. Candidate discovery must never imply byte identity.

Permanent deletion from this page is allowed only after all of the following occur in order:

1. The user reviews the candidate group and chooses the file to keep.
2. A separate read-only stage fully reads every file in that group and compares complete SHA-256 values.
3. The result for the whole group is `完全相同`.
4. The user completes a second permanent-delete confirmation.
5. The main process rechecks the verified file version immediately before deletion.

Any cancelled, failed, offline, unreadable, changed, incomplete, or stale verification result is ineligible for deletion. The renderer must not show an enabled permanent-delete action for it.

## 2. Minimal interaction model

Keep the existing `重复项` navigation entry, filters, pagination, group cards, keep selection, playback, details, and open-folder actions. Do not redesign the library shell.

Replace the existing direct flow with these states. State names are descriptive and do not require matching implementation identifiers.

| Stage | Required UI | Allowed actions | Delete eligibility |
| --- | --- | --- | --- |
| `candidate_idle` | Metadata-only warning, candidate groups, keep choice | Play, details, open folder, change keep item, start verification | None |
| `verification_preflight` | Read volume and network-cost explanation | Return to review, start full verification | None |
| `verifying` | File/group progress, current file, elapsed time, read-only promise | Cancel verification | None |
| `cancelling` | Cancellation-in-progress message | Wait only | None |
| `verification_result` | Per-group result: identical, different, or unverifiable | Return, retry unverifiable groups, continue with identical groups | Identical groups only |
| `delete_confirm` | Exact eligible count/size, typed confirmation, final-check promise | Cancel without deletion, permanently delete | Identical groups represented by a fresh verification token only |
| `final_version_check` | Blocking final-check progress | Wait only | None until the check passes |
| `deleting` | Background or foreground deletion status | Stop remaining deletions, if supported | Only items that passed the final version check |
| `delete_result` | Deleted, blocked, failed, and skipped items separated | Close, open location, reverify blocked/failed items | None until a new verification run |

Closing or cancelling any state before `deleting` deletes nothing. A verification result must be bound to the exact path, size, modified time, and hash that were checked. Do not silently reuse an expired result.

## 3. Candidate page copy

### Page warning

Replace the current low-bandwidth warning with:

> 当前仅按文件大小和时长发现候选项，不能证明内容相同。永久删除前必须完整读取候选文件并校验 SHA-256。

### Summary labels

- `同大小候选组` becomes `候选组`
- `候选文件` stays `候选文件`
- The third summary card becomes `待完整验证`
- `预计可释放` becomes `候选可释放空间`

The release-space value is an estimate until deletion succeeds. Do not label it as already reclaimable.

### Group and item labels

- `重复组 01` becomes `候选组 01`
- Group description: `N 个大小和时长相同的候选文件 · 需完整验证`
- Selected keep item badge: `保留此文件`
- Recommendation badge: `建议保留`
- Every other item badge before verification: `待验证`
- Never show `待删除` before full verification succeeds.

The keep action remains non-destructive and is labelled `保留此文件`. Playback, details, and open-folder controls remain available throughout candidate review.

### Primary action

Replace `清理当前页` with `验证当前页`.

Visible helper text directly beside or below the action:

> 完整读取当前页计划中的文件并比较 SHA-256。此阶段不会删除文件。

The primary action is not styled as destructive. Use the normal primary/accent treatment. Red is reserved for the final permanent-delete action.

## 4. Verification preflight and progress

### Preflight dialog

Title:

> 开始完整内容验证？

Body:

> 将完整读取当前页计划中的 N 个文件，共 Y。网络盘可能需要较长时间。验证只读取文件，不会删除、移动或重命名任何内容。

Actions:

- Safe secondary: `返回检查`
- Primary, non-danger: `开始验证`

Do not begin full file reads before the user chooses `开始验证`.

### Running dialog

Title:

> 正在进行完整内容验证

Required visible status:

- `已验证 A / B 个文件`
- `当前：<filename>`
- Determinate bytes or percentage when available; otherwise an indeterminate progress indicator plus text
- `已等待 N 秒`
- Persistent promise: `此阶段只读取文件，不会删除任何内容。`

Action:

- `取消验证`

After cancellation is requested:

- Title becomes `正在取消验证…`
- Body: `正在等待当前读取安全停止。不会删除任何文件。`
- Disable repeated cancellation.
- Never advance to permanent-delete confirmation from this run.

If an operating-system read cannot stop immediately, the UI must remain honest and wait for the cancellation acknowledgement. Do not report `已取消` while bytes are still being read.

## 5. Verification result semantics

Results are assigned at group level because every file must match the chosen keep file.

| Result | Visible label | Required message | Permitted next action |
| --- | --- | --- | --- |
| Complete match | `完全相同` | `完整 SHA-256 一致，可进入永久删除确认。` | Continue to confirmation |
| Hash mismatch | `内容不同` | `完整 SHA-256 不一致，不会删除此组任何文件。` | Return and inspect files |
| Offline/read failure/missing/change | `无法验证` | `<具体原因>，不会删除此组任何文件。` | Retry verification |

Result dialog title:

> 内容验证结果

Summary:

> 完全相同 A 组 · 内容不同 B 组 · 无法验证 C 组

Actions:

- Always available: `返回重复项`
- When unverifiable groups exist: `重新验证无法验证项`
- Only when identical groups exist: `继续永久删除确认`

If the whole run is cancelled or the verification service fails globally, show a status banner instead of the result-to-delete flow:

- Cancelled: `验证已取消，未删除任何文件。`
- Global failure: `内容验证失败，未删除任何文件。请检查连接后重试。`

Completed partial hashes may be shown for diagnostics, but cancellation does not produce a reusable deletion token.

## 6. Second permanent-delete confirmation

This must be a new, separate `alertdialog`. It cannot be the verification progress dialog with changed buttons.

Title:

> 永久删除已验证的重复文件？

Required summary:

> 已完整验证 A 组。将保留 B 个文件，永久删除 C 个文件，预计释放 Y。

Required warning:

> 删除不会进入回收站，且无法撤销。删除前会再次检查路径、文件大小和修改时间；任何变化都会阻止对应文件删除。

Typed confirmation:

- Label: `输入 DELETE 以确认永久删除`
- The danger action remains disabled until the exact value is `DELETE`.
- Do not trim, localize, or accept case variants silently.

Actions:

- Safe: `取消，不删除`
- Danger: `永久删除 C 个已验证文件`

The danger action must never receive initial focus. Initial focus goes to the confirmation input or the safe cancel button.

After the danger action is activated, show `正在执行删除前最终检查…`. If any version field changed, show:

> 文件版本已变化，已阻止删除。请重新进行完整内容验证。

The changed file must not be deleted, even if another item in the batch succeeds.

## 7. Entry-point and bypass rules

The following current paths must not bypass full verification:

1. `DuplicateGroupsPage` current-page cleanup at `src/renderer/components/DuplicateGroupsPage.tsx:330`.
2. `DuplicateCleanupButton` background submission at `src/renderer/components/DuplicateCleanupButton.tsx:121`.
3. The single-item trash action currently exposed from a candidate group.
4. Task-center `恢复` and `重试失败项` at `src/renderer/components/DuplicateCleanupTasksPanel.tsx:76` and `:77`.

Minimum-scope choice for the single-item action: remove the trash action from candidate cards for this task. If it is retained later, label it `验证并删除…` and route it through the exact same verification and second-confirmation sequence.

Task-center changes:

- `取消` during deletion becomes `停止剩余删除`.
- Helper text: `已完成的永久删除无法撤销；停止只影响尚未开始的文件。`
- `恢复` becomes `重新验证并继续` and must create a new full verification result before further deletion.
- `重试失败项` becomes `重新验证失败项`; it must not retry deletion directly.
- A stale or missing verification token is rendered as `验证已失效，未删除`.

Any renderer, IPC, background job, resume, retry, or single-item path that can reach permanent deletion without fresh full SHA-256 verification and second confirmation is a release blocker.

## 8. Focus, keyboard, and accessibility contract

All dialogs in this flow must implement the same modal behavior:

- Move focus inside on open.
- Trap Tab and Shift+Tab within the dialog.
- Make the page behind the dialog inert to pointer and keyboard input.
- Restore focus to the exact invoking control on close.
- Provide a visible `:focus-visible` treatment on every button, input, and link.
- Do not rely on color alone for result states; pair icon, label, and explanatory text.

Escape behavior:

- Preflight: same as `返回检查`.
- Verifying: same as `取消验证`.
- Cancelling: no-op until cancellation is acknowledged.
- Result: same as `返回重复项` and no deletion.
- Delete confirmation: same as `取消，不删除`.
- Final version check or active deletion: Escape does not hide status or imply cancellation.

Initial focus:

- Preflight: `返回检查`.
- Verifying: `取消验证`.
- Result: result heading with `tabIndex=-1`, then normal tab order.
- Delete confirmation: typed-confirmation input.
- Final result: result heading or safe close action.

Announcements:

- Use `role="alert"` for global verification failure, version-change blocking, and deletion failure.
- Use a throttled `aria-live="polite"` region for file-count progress and cancellation acknowledgement. Do not announce every byte update.
- Use native `<progress>` with an accessible name when progress is determinate.
- Spinner animation must be accompanied by text and respect reduced motion.
- Truncated filenames and paths retain the complete value through accessible text or an explicit copy/details action.

Global library paging shortcuts must remain suppressed while any dialog in this flow is open.

## 9. Visual treatment

Preserve the current dark neutral and coral visual language. This task is not a redesign.

- Candidate and verification actions use the normal accent treatment.
- `完全相同` uses success styling plus text/icon.
- `内容不同` uses neutral-warning styling, not danger red.
- `无法验证` uses amber warning styling plus the concrete reason.
- Red is reserved for the final permanent-delete action and deletion failure.
- Progress UI should use the existing compact desktop density and fit at 900 px window width without horizontal overflow.

## 10. Required UI tests and acceptance gate

Automated renderer coverage must prove:

1. Candidate items never display `待删除` before successful full verification.
2. Starting candidate cleanup opens the bandwidth/read-volume preflight before any verification call.
3. Cancelling verification never opens delete confirmation and announces zero deletion.
4. Different and unverifiable groups have no enabled permanent-delete action.
5. Only identical groups populate the second confirmation.
6. The permanent-delete action stays disabled until exact `DELETE` input.
7. Version-change response renders the blocking message and no success claim.
8. Single-item delete, retry, and resume cannot submit deletion without a new verification result.
9. Escape behavior, focus trap, initial focus, and focus restoration match Section 8.
10. The deletion task center distinguishes `停止剩余删除` from zero-delete validation cancellation.

Real Electron UI gate:

- Verify a fast local-file batch, a slow mapped-drive batch, cancellation during read, offline transition, read error, content mismatch, version change after hashing, and mixed eligible/ineligible groups.
- Capture screenshots for candidate, preflight, progress, each result state, second confirmation, final-check block, and mixed deletion result at 1280x720 and 900x700.
- Confirm no path reaches permanent deletion without full hash, fresh version recheck, and second confirmation. Any bypass is `UI_REVIEW_FAILED` and a release blocker.

## 11. Out of scope

- Redesigning the main library navigation, duplicate filters, pagination, group-card layout, or player.
- Hashing during ordinary browsing or candidate discovery.
- Automatic deletion after verification.
- Weakening the full SHA-256 requirement because of network cost.
- Treating partial hashes, size, duration, or cached metadata as `完全相同`.
