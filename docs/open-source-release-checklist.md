# Open Source Release Checklist

Use this checklist before announcing the project as an official public open-source release.

## 1. Repository governance

- [ ] Protect `main`: pull request required, force-push disabled, deletion disabled.
- [ ] Require Windows CI checks before merge.
- [ ] Require CODEOWNERS review for security-sensitive files.
- [ ] Protect `v*` release tags or otherwise restrict tag creation.
- [ ] Enable GitHub secret scanning and push protection when available.
- [ ] Enable private vulnerability reporting when available.

## 2. Credentials and private data

- [ ] Run a full Git-history secret scan, not only a working-tree search.
- [ ] Rotate any credential that has ever appeared in Git history.
- [ ] Confirm no real API tokens, passwords, certificates, private media lists, or machine-specific paths are committed.
- [ ] Keep runtime databases, caches, logs, diagnostic bundles and settings out of Git.
- [ ] Ensure CloudDrive and subtitle credentials never appear in Renderer-visible snapshots or normal logs.

## 3. CloudDrive

- [ ] Store the CloudDrive token using OS-backed secure storage.
- [ ] Renderer should receive only a configured/not-configured indicator, never the real token.
- [ ] Allow plain HTTP only for loopback endpoints; require HTTPS for non-loopback hosts.
- [ ] Mark fast remote deletion clearly as a high-risk mode if it bypasses full content hashing.
- [ ] Default to the safer verification flow for general users.

## 4. Destructive operations

- [ ] Recheck IDs and paths in the main process immediately before destructive operations.
- [ ] Keep renderer-supplied paths untrusted.
- [ ] Confirm duplicate deletion has a documented verification model.
- [ ] Test rename/delete/move under Windows ACL denial, file locks, disk-full, SMB disconnect and cross-volume scenarios.
- [ ] Ensure failures do not silently remove database records when the file operation failed.

## 5. Electron security

- [ ] `contextIsolation: true`
- [ ] `nodeIntegration: false`
- [ ] `sandbox: true`
- [ ] strict production CSP
- [ ] blocked arbitrary navigation/window creation
- [ ] IPC sender, top-frame, URL and role checks
- [ ] no credential-bearing values exposed through preload APIs

## 6. Release supply chain

- [ ] Build/test job uses `contents: read`.
- [ ] Signing secrets are scoped only to the installer-signing step.
- [ ] Publishing happens in a separate job with `contents: write`.
- [ ] Consider a protected GitHub Environment with manual approval for production signing.
- [ ] Publish installer checksum and build metadata.
- [ ] Verify upgrade from the previous signed release on a clean Windows VM.

## 7. Licensing and notices

- [ ] Choose the project license deliberately; do not add a license until distribution obligations are understood.
- [ ] Review bundled FFmpeg licensing and redistribution obligations.
- [ ] Add `THIRD_PARTY_NOTICES.md` before distributing binaries.
- [ ] Verify third-party fonts, icons, images and sample media can legally be redistributed.
- [ ] Document source-code and binary-distribution obligations separately if they differ.

## 8. Privacy and network disclosure

- [ ] Document which features make network requests.
- [ ] Explain that subtitle search queries/file titles may be sent to third-party subtitle providers.
- [ ] State whether telemetry exists; if none exists, say so explicitly.
- [ ] Keep diagnostic export opt-in for full paths and credentials excluded by default.

## Release decision

Do not mark a build as an official internet release until all P0 items above are closed and remaining P1 items are documented with an explicit owner and acceptance decision.
