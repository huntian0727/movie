# Agent Handoffs

This directory stores short-lived role-to-PM and PM-to-role handoffs. Durable product facts belong in `docs/ai/`; pushed Web Advisor context belongs in `docs/ai/web-handoff/`.

New role handoffs are UTF-8 JSON: `<TASK-ID>-dev.json`, `<TASK-ID>-qa.json`, and `<TASK-ID>-ui.json`. Use the matching template. PASS is short; only failures add findings, reproduction, impact, and rework scope. Formal routing always passes through the Local PM. Existing Markdown handoffs are historical evidence and need not be rewritten.
