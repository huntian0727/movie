# Web Advisor Handoffs

This directory contains minimal remote context packages for the external Web Advisor. A handoff is valid only when its branch and full SHA are already pushed to GitHub.

Use `scripts/agent/generate-web-handoff.ps1`, replace all evidence placeholders, list changed code/tests/docs and recommended review order, commit/push the handoff, then run `scripts/agent/verify-handoff.ps1`. `-OutputPath` accepts only direct `.md` files inside this directory; traversal, external paths, other extensions, and reparse-point targets fail closed. The recorded SHA is the already-pushed code snapshot under review; the validator requires it to remain an ancestor of the named remote branch, allowing the handoff itself to be committed afterward. `LATEST.md` is the current review target; task-specific files may be retained for major decisions or milestones.

Do not include local-only logs, databases, media, secrets, unpublished screenshots, or claims that cannot be reproduced from the pushed commit and attached evidence.
