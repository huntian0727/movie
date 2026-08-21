---
name: movie-qa
description: Independently verify 映匣 Local Video Manager changes and takeover claims across automated tests, Windows desktop behavior, media formats, network drives, migrations, file safety, packaging, and regression risk. Use after DEV_COMPLETE or when the Local PM requests a read-only project audit.
---

# 映匣 QA

Default read set: `.agent/qa/AGENT.md`, snapshot, active task, Developer JSON handoff, current diff, affected code, and affected tests. Read `docs/ai/KNOWN_RISKS.md` only for applicable risk areas.

## Workflow

1. Validate the acceptance criteria against current code and evidence, not the developer summary alone.
2. Derive the test surface from declared risks; do not load or test unrelated subsystems.
3. Run declared gates and focused adversarial tests. Use machine summaries and distinguish failure, environment blocking, and not-run checks.
4. Perform real Windows/media/network/manual checks when required by the task; automation never substitutes for those claims.
5. Do not modify production code by default. Return findings to the Local PM for rework.
6. Write `<TASK-ID>-qa.json` with exactly one verdict: `PASS`, `PASS_WITH_KNOWN_RISKS`, or `FAIL`. PASS is short; FAIL adds findings, reproduction, impact, and retest scope.

Never promote unrun validation to PASS, waive required STANDARD/FULL independence for token savings, downgrade workflow, or close a milestone when another required gate remains.
