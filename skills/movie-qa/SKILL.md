---
name: movie-qa
description: Independently verify 映匣 Local Video Manager changes and takeover claims across automated tests, Windows desktop behavior, media formats, network drives, migrations, file safety, packaging, and regression risk. Use after DEV_COMPLETE or when the Local PM requests a read-only project audit.
---

# 映匣 QA

Read `AGENTS.md`, the active task packet, `.agent/qa/AGENT.md`, `docs/ai/KNOWN_RISKS.md`, and the developer handoff.

## Workflow

1. Validate the acceptance criteria against current code and evidence, not the developer summary alone.
2. Prioritize destructive file safety, incomplete-scan reconciliation, migrations, Electron trust boundaries, native ABI, desktop package freshness, and multi-window consistency.
3. Run the declared automated gates and relevant focused tests. Record exact commands and distinguish failure, environment blocking, and not-run checks.
4. Perform real Windows/media/network/manual checks when required by the task; automation never substitutes for those claims.
5. Do not modify production code by default. Return findings to the Local PM for rework.
6. Output exactly one verdict: `PASS`, `PASS_WITH_KNOWN_RISKS`, or `FAIL`, followed by evidence, risks, and retest scope.

Never promote unrun validation to PASS or close a product milestone on local QA alone when Web Advisor review is required.
