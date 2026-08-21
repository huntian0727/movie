# Project Manager Memory

- Product: Windows Electron desktop-only local video library.
- Source video is the source of truth; SQLite is an index and user-state store; media cache is rebuildable.
- Current schema baseline at takeover: v9.
- Playback baseline: codec-aware `auto`, bounded two-second lazy probe wait, native → mpv → system fallback.
- Local roles: Project Manager, Developer, QA, UI/UX Designer.
- External role: Web Advisor for WHAT/WHY/SHOULD WE/WHAT NEXT and independent milestone review.
- Durable product facts live in `docs/ai/`; operational ownership and task state live in `.agent/`.
- Never tell Web Advisor to review local-only code. Push first and provide a changed-files review scope.
