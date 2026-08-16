# TASK-PM-001 — Project Takeover

- Task ID: TASK-PM-001
- Title: Establish the Local PM, Developer, QA, UI/UX, and Web Advisor collaboration system
- Priority: P0
- Owner: Local Project Manager
- Background: The project has strong code/delivery documentation but no durable operational agent layer.
- User Goal: Let the user work mainly with the Local PM and Web Advisor while specialist roles execute locally.
- Product Goal: Make project state, ownership, gates, risks, and recovery durable across agent sessions.
- Scope: Read current facts; audit Git/code/tests/UI; create `.agent/`, role skills, deterministic gate scripts, Web Advisor handoff protocol, and takeover report.
- Out of Scope: Playback features, database changes, UI redesign, CloudDrive changes, source-file cleanup, release packaging.
- Technical Constraints: Preserve business code and user data; no destructive Git; facts follow code/migrations/tests/Git/evidence order.
- Acceptance: Required role files, state files, task/handoff formats, gates, skills, validation, and takeover report exist and agree with current Git/code facts.
- Automated Tests: Skill validation; PowerShell gate validation; project lint/build/test gate when safe for docs/tooling changes.
- Local Validation: Git sync and clean-baseline checks; specialist read-only audits; script dry runs.
- QA Required: YES
- UI Required: YES (audit only)
- Web Advisor Review Required: NO
- Web Advisor Review Stage: NOT_REQUIRED
- Git Requirements: `ai/project-takeover`; delivery record; normal push; remote SHA verification; no force push.
- Status: LOCAL_ACCEPTED
- Next Actor: Local Project Manager (Git delivery), then User/Web Advisor for `TASK-SAFETY-001`

## QA Rework 1

- `run-qa-gate.ps1 -IncludeElectronSmoke` incorrectly mixes the Node ABI gate and Electron ABI smoke in one checkout. Split or block that path so ABI isolation is enforced.
- Restrict `generate-web-handoff.ps1 -OutputPath` to `docs/ai/web-handoff/*.md` under the repository root.
- Confirm every skill `agents/openai.yaml` default prompt explicitly names its `$movie-*` skill.

## Developer Rework Evidence 1

- `scripts/agent/run-qa-gate.ps1` now runs only `test:release-gate`. The legacy `-IncludeElectronSmoke` switch fails before npm is invoked and directs Electron smoke to a separate Electron ABI checkout/desktop gate.
- `scripts/agent/generate-web-handoff.ps1` resolves the repository root and output path, requires a direct `.md` child of `docs/ai/web-handoff/`, and rejects output-directory or target-file reparse points.
- Confirmed all four `skills/movie-*/agents/openai.yaml` default prompts explicitly contain the matching `$movie-*` skill name.
- Added `tests/scripts/agentManagementScripts.test.ts` to execute the PowerShell safety paths with isolated temporary repositories and a fake npm executable.
- `npx vitest run tests/scripts/agentManagementScripts.test.ts`: PASS, 1 file and 6/6 tests.
- `npm run typecheck`: PASS.
- Production source, package metadata, database migrations, and application behavior are unchanged.

## Independent QA Evidence

- Verdict: `PASS_WITH_KNOWN_RISKS` for the management layer; `TASK-CI-001` is local `QA_PASS`.
- Focused management/CI tests: 2 files, 9/9 PASS.
- Fixed Node 22.23.1/npm 10.9.8 `npm run test:release-gate`: PASS; lint/build, 37 Windows file tests, 31 migration tests, 21 performance tests, and 46 files/441 total tests passed.
- Seven PowerShell scripts parsed with zero AST errors; unsafe mixed ABI, handoff traversal, external output, and non-Markdown output fail closed.
- Four `movie-*` skills passed UTF-8 quick validation and explicit prompt checks.
- Known risks: remote GitHub CI is pending until push; Electron smoke is intentionally NOT RUN in this Node ABI checkout; the upstream skill validator is not repository-self-contained.
