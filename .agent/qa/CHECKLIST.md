# QA Checklist

- [ ] Read the task packet, developer handoff, known risks, and affected tests.
- [ ] Confirm acceptance criteria are observable and complete.
- [ ] Re-run relevant tests independently and record commands/results.
- [ ] Check P0 invariants: source-file safety, incomplete scan, migration, IPC/security, desktop-only runtime.
- [ ] Check P1 invariants relevant to the task.
- [ ] Separate automated evidence, manual evidence, NOT RUN, and environment blockers.
- [ ] Verify desktop package/shortcut freshness when Electron behavior changed.
- [ ] Keep the Node release gate and Electron smoke in separate ABI checkouts; never run both sequentially in one checkout.
- [ ] Report one allowed verdict, findings by priority, and retest scope.
