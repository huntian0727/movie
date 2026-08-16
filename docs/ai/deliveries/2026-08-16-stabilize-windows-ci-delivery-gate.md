---
date: 2026-08-16
branch: ai/project-takeover
type: test
status: partial
---

# Stabilize the Windows delivery-gate assertion

## Context

The delivery script correctly rejected a change with no delivery record, but PowerShell automatically wrapped the error text inside a word. The formatting-sensitive test therefore failed even though the policy remained enforced.

## Changes

- Keep the rejection assertion tied to the exact ordered phrase `Every delivery must add or update`.
- Allow whitespace to be inserted between any phrase characters so PowerShell line wrapping does not change the result.
- Do not change production code or the `finish-and-push.ps1` delivery policy.

## Verification

- Initial `npx vitest run tests/scripts/finishAndPush.test.ts`: FAIL, reproducing PowerShell output with `add` wrapped as `a\ndd`.
- Final `npx vitest run tests/scripts/finishAndPush.test.ts`: PASS, 1 file and 3/3 tests.
- Independent QA focused rerun under Node 22.23.1: PASS, 1 file and 3/3 tests.
- Independent QA fixed environment: Node 22.23.1 and npm 10.9.8; project environment verification passed.
- Independent QA final `npm run test:release-gate`: PASS after the management-script safety rework. Lint/build passed; Windows file safety 37/37, migrations 31/31, release performance 21/21, and the complete Node suite 46 files/441 tests all passed.
- Independent QA `git diff --check`: PASS.
- Scope inspection: no product source, migration, dependency manifest, or `scripts/finish-and-push.ps1` behavior changed.

## Risks and follow-up

- Local QA is complete. The pushed SHA still requires a green GitHub Windows CI run before final delivery.
- The test remains dependent on the English semantic policy message, intentionally failing if that rejection message or behavior is removed.
