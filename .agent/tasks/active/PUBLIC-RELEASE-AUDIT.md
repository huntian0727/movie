# PUBLIC-RELEASE-AUDIT

- Workflow: FULL
- Risk Areas: security boundaries, complete Git history, permanent file deletion, dependencies/licensing, Electron upgrade, installer/data preservation, signing/release governance
- QA Required: YES (independent audit and final diff review)
- UI Required: YES (actual rebuilt desktop/shortcut and destructive-action confirmation review)
- Web Advisor Required: NO (primary-source research is performed in this task)
- Workflow Reason: public release, irreversible file actions and installer/security boundaries require FULL.
- Status: UI_REVIEW
- Owner: Local PM / primary implementation agent
- Branch: ai/public-release-audit
- Baseline: origin/main 807c495

## Scope and acceptance

Audit actual source/config/history; redact all reported sensitive values. Identify P0/P1/P2 risks, fix scoped engineering issues without lowering safety, run complete regression on a supported Electron upgrade, inspect all distributed binaries and licensing, improve installation/release/signature/checksum gates and user documentation. Produce an explicitly unsigned-test-build installer when signing credentials are absent, hashes, actual test evidence and an honest PASS / PASS_WITH_RISKS / FAIL public-release conclusion. Submit only the work branch and PR for review; do not update main, rewrite history, rotate live keys, publish releases/tags or touch real user data.

License selection, ownership declarations and signing credentials remain user decisions. Prepare reviewable license material without granting a license on the owner's behalf. Destructive tests must use temporary fixtures and isolated install profiles. Clean Windows 11/no-Node validation must be actual or explicitly NOT RUN.

## Declared gates

Full-history and working-tree secret/privacy scan; production and development dependency audit; license/binary provenance inventory; deletion/security adversarial regression; typecheck/build; test:release-gate; real Electron smoke; package:dir and artifact verification; packaged smoke; NSIS installer/upgrade/uninstall smoke; actual shortcut/UI; independent QA findings; Git diff/safety/push/PR checks. Preserve failures and environmental limitations in the report.

## Next actor

Independent audit agents return evidence and findings to the Local PM. Implementation remains with the primary agent. Final independent QA reviews the final diff and actual verification evidence before delivery.
