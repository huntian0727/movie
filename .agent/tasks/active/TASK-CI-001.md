# TASK-CI-001 — Stabilize Windows CI delivery-gate assertion

- Task ID: TASK-CI-001
- Title: Make the missing-delivery-record assertion robust to PowerShell line wrapping
- Priority: P0 (delivery gate)
- Owner: Developer Agent
- Background: GitHub Windows CI for `main@7506da5` reports 434/435 tests because PowerShell inserts a newline between “Every” and “delivery”; the gate correctly rejects the operation but the test regex is formatting-sensitive.
- User Goal: Restore a trustworthy green remote delivery gate.
- Product Goal: Prevent CI presentation formatting from masking the actual delivery-policy behavior.
- Scope: Adjust the isolated `finishAndPush` test assertion to validate the semantic error across whitespace wrapping; add no product behavior.
- Out of Scope: Change `finish-and-push.ps1` policy, bypass delivery records, change application code, or weaken the rejection behavior.
- Technical Constraints: Test must still fail if the missing-delivery-record policy stops rejecting; remain Windows/PowerShell compatible.
- Acceptance: Focused test passes locally; full Node/release gate passes; diff is limited to test/evidence/management records.
- Automated Tests: `tests/scripts/finishAndPush.test.ts`; full release gate.
- Local Validation: Confirm GitHub failure text and rerun focused test on Windows.
- QA Required: YES
- UI Required: NO
- Web Advisor Review Required: NO
- Web Advisor Review Stage: NOT_REQUIRED
- Git Requirements: Remain on `ai/project-takeover`; include delivery record; normal push only.
- Status: QA_PASS
- Next Actor: Local Project Manager

## Developer Evidence

- Changed only the missing-delivery-record assertion in `tests/scripts/finishAndPush.test.ts`; production code and `scripts/finish-and-push.ps1` are unchanged.
- Initial focused run reproduced the Windows failure: PowerShell wrapped `add` as `a\ndd`, so word-boundary whitespace matching was insufficient.
- The final assertion requires the exact ordered phrase `Every delivery must add or update` while allowing PowerShell to insert whitespace between any characters.
- `npx vitest run tests/scripts/finishAndPush.test.ts`: PASS, 1 file and 3/3 tests.
- Full Node/release gate: NOT RUN by Developer Agent; pending independent QA.

## Independent QA Evidence

- QA verdict: `PASS` for the local change; the remote Windows CI rerun remains a post-push delivery check.
- Fixed environment: Node `22.23.1`, npm `10.9.8`; `npm run verify:environment` passed.
- `npx -y node@22.23.1 node_modules/vitest/vitest.mjs run tests/scripts/finishAndPush.test.ts --reporter=dot`: PASS, 1 file and 3/3 tests.
- `npm run test:release-gate`: PASS under the fixed environment after PM-tooling rework. Lint/build passed; Windows file safety 37/37, migrations 31/31, release performance 21/21, and the complete Node suite 46 files/441 tests all passed.
- `git diff --check`: PASS.
- Scope audit: no `src/`, migration, package manifest, application script, or other production-code file changed; the executable change is limited to `tests/scripts/finishAndPush.test.ts`.
- Remaining delivery check: commit and push normally, then require the GitHub Windows CI run for the pushed SHA to be green before marking the task delivered.
