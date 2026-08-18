# Risk-Based Local Delivery Workflow

## Selector

| Workflow | Use when | Default roles/gates |
| --- | --- | --- |
| `LITE` | Small, reversible, localized change with no schema, migration, irreversible file action, playback core, CloudDrive core, installer/release, major UI, lifecycle/concurrency/security, or unrecoverable risk | Developer + targeted automated gate |
| `STANDARD` | Scoped bug or feature with meaningful regression/cross-layer risk but no high-risk trigger | Developer + independent targeted QA; UI only for material visible behavior |
| `FULL` | Permanent/batch user-file action, data-loss risk, large migration, playback architecture, CloudDrive core, major UI redesign, installer/release, security boundary, or other irreversible/high-impact change | Developer + independent QA + all applicable UI/Web/release gates |

Every task records `Workflow`, `Risk Areas`, `QA Required`, `UI Required`, `Web Advisor Required`, and `Workflow Reason`. Risk may auto-escalate. Developer/QA/UI may request escalation but cannot downgrade; only the PM may downgrade and must record why. Discovery that actual impact exceeds scope produces `SCOPE_ESCALATION_REQUIRED`: stop expansion, report evidence and recommended level, then wait for PM routing.

## State machine

`PLANNED → READY_FOR_DEV → IN_DEVELOPMENT → DEV_COMPLETE → IN_QA? → QA_FAILED/REWORK or QA_PASS? → UI_REVIEW? → LOCAL_ACCEPTED → DELIVERED → VERIFIED`

Use design, Web, desktop, and release stages only when declared by risk. LITE skips independent QA by default; STANDARD/FULL never skip QA when `QA Required=YES`.

## Formal handoff

1. Current owner writes a short JSON handoff under `.agent/handoffs/`.
2. Local PM updates state and assigns the next actor; it links the handoff instead of rewriting it.
3. The next actor reads the handoff and validates source evidence independently.

Developer, QA, and UI roles do not formally hand work directly to one another.

## Delivery gates

- Task gate: compact packet exists and includes selector fields and acceptance criteria.
- Developer gate: relevant tests, lint/build as declared, diff review, `DEV_COMPLETE`.
- QA gate: independent verdict and evidence when required.
- UI gate: required for major UI or explicitly declared visible-behavior review; start from screenshots/design system.
- Git gate: machine state records branch/SHA/diff/sync; delivery depth follows workflow level.
- Desktop gate: use a separate Electron ABI checkout to run Electron smoke, rebuild the package, verify `app.asar`/commit/shortcut, and launch via the real shortcut when Electron behavior changed.
- Web Advisor gate: pushed, minimal handoff plus explicit questions when required.

## Context and documentation

Start from `.agent/context/PROJECT_SNAPSHOT.md`, the active task, current role rule, and latest required handoff. Expand to 3–8 affected files/tests first. Current code > migrations > tests > Git > latest formal docs > snapshot. LITE normally needs only JSON handoff + commit; STANDARD adds a short delivery record when needed; FULL/release keeps formal delivery evidence. Successful handoffs contain only outcome and proof; failures add findings, impact, reproduction, and rework scope.
