# Agent Handoffs

This directory stores short-lived role-to-PM and PM-to-role handoffs. Durable product facts belong in `docs/ai/`; pushed Web Advisor context belongs in `docs/ai/web-handoff/`.

Every handoff records task ID, from/to roles, status, branch/SHA, changed files, evidence, risks, requested action, and next actor. Formal routing always passes through the Local PM.
