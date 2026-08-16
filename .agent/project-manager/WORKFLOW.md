# Local Delivery Workflow

## State machine

`PLANNED → WEB_REVIEW_PENDING? → DESIGNING? → READY_FOR_DEV → IN_DEVELOPMENT → DEV_COMPLETE → IN_QA → QA_FAILED/REWORK or QA_PASS → UI_REVIEW? → LOCAL_ACCEPTED → WEB_REVIEW_PENDING? → WEB_REVIEWED? → DELIVERED → VERIFIED`

Only use Web review stages declared in the task packet. `WEB_REVIEW_PENDING` may occur before design, development, an architecture decision, after QA, before release, or at milestone review.

## Formal handoff

1. Current owner writes evidence into the task packet or `.agent/handoffs/`.
2. Local PM reviews it and updates project/current-task state.
3. Local PM assigns the next actor.
4. The next actor validates source evidence independently.

Developer, QA, and UI roles do not formally hand work directly to one another.

## Delivery gates

- Task gate: scoped packet exists and has acceptance criteria.
- Developer gate: relevant tests, lint/build as declared, diff review, `DEV_COMPLETE`.
- QA gate: independent verdict and evidence.
- UI gate: required for visible behavior; includes desktop screenshot/interaction review.
- Git gate: delivery record, clean committed tree, pushed task branch, verified remote SHA.
- Desktop gate: use a separate Electron ABI checkout to run Electron smoke, rebuild the package, verify `app.asar`/commit/shortcut, and launch via the real shortcut when Electron behavior changed.
- Web Advisor gate: pushed, minimal handoff plus explicit questions when required.
