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
- Next Actor: Local Project Manager (Git delivery)

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

## CI Rework 2

- Remote run `31948200847` passed Electron smoke and reached 440/441 Node tests; the only failure compared an `os.tmpdir()` 8.3 short path with PowerShell's equivalent long path.
- The successful handoff-generation assertion no longer compares the output path literal, casing, or short/long expansion.
- It now requires semantic output containing `TASK-PM-TEST.md`, `origin/ai/handoff-test`, and a 40-character hexadecimal SHA.
- The existing `readFileSync(allowedOutput)` assertion remains and proves that the generated handoff is actually written at the allowed resolved location.
- `npx vitest run tests/scripts/agentManagementScripts.test.ts`: PASS, 1 file and 6/6 tests.
- Safety scripts and business code are unchanged in this rework.

## Independent QA Rework 2

- QA verdict: `QA_PASS`; task state advanced to `LOCAL_ACCEPTED` for local scope.
- Remote failure run `31948200847` was independently inspected: Electron smoke passed and the sole Node failure was the equivalent `RUNNER~1` versus `runneradmin` temporary-path rendering.
- `npx -y node@22.23.1 node_modules/vitest/vitest.mjs run tests/scripts/agentManagementScripts.test.ts --reporter=dot`: PASS, 1 file and 6/6 tests.
- The success assertion does not compare absolute paths, path casing, or 8.3/long-path expansion. It still requires `TASK-PM-TEST.md`, `origin/ai/handoff-test`, and a 40-character hexadecimal SHA in the generated status line.
- `readFileSync(allowedOutput)` still reads the file at the actual allowed path and verifies generated Web Advisor handoff content.
- `git diff --check`: PASS.
- Scope audit: `scripts/agent/`, `src/`, package manifests, and database migrations are unchanged relative to `origin/ai/project-takeover`; only the test assertion and management evidence changed.
- Delivery follow-up: push normally and require a green GitHub Windows CI run for the new SHA.
