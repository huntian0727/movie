# Release 0.1.16 鈥?PAUSED BY OWNER

Date: 2026-10-19
Status: Formal/public release paused at the owner's request. The owner has additional changes to make and wants to release all changes together.

Rules until resumed:
- Do not publish the 0.1.16 draft, make it public, upload public downloads, overwrite the existing 0.1.15 stable release, or create a new public tag.
- Keep existing candidate ZIPs and the private GitHub draft as private QA artifacts; do not represent them as approved releases.
- Do not modify release approval JSON/evidence merely to make 0.1.16 appear approved.
- When the owner says the additional modifications are complete, collect all changes, reconcile with the active branch and collaboration handbook, rebuild from the final commit, run full tests and fresh isolated Windows QA, regenerate release notes/docs/metadata/checksums, verify exact source-to-binary and uploaded asset binding, then publish once after all gates pass.
- Existing test results are provisional and must be rerun against the final combined changes.
- Existing 0.1.15 stable release must remain untouched until final approval.

Current observations (2026-10-19):
- Working branch: ai/release-0.1.16-community.
- Candidate commit: c9b1ae4 (private release preparation).
- Previous functional commits include de79c41 (separate actionable issues from deferred metadata tasks) and e9e6d65 (exception overview tab/header layout fix).
- Package version is 0.1.16, but release approval metadata still identifies approved stable version 0.1.15. Do not treat that mismatch as approval for 0.1.16.
- A 0.1.16 portable ZIP has been generated and local artifact verification and packaged smoke checks were run. Full release gate reported 2 failed test files / 3 failed tests, including release-evidence/package-lock SHA-256 pins. This must be resolved for the final combined release.
- Windows Sandbox visual QA attempt did not produce a passing report. Do not claim isolated GUI acceptance for 0.1.16.
- GitHub draft exists: candidate-v0.1.16-private-prep-20261019, title 鈥淢ovie 0.1.16 Private Candidate鈥? It must remain a draft and is not a public release.
- Prior 0.1.15 release/docs remain current public release material.

Next step: wait for the owner to finish the additional changes. Do not continue release execution unless specifically asked to resume.