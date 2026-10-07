# Security Policy

## Supported Versions

Security fixes are applied to the current `main` branch and the latest published release unless a release note states otherwise.

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for suspected vulnerabilities that could expose user files, credentials, signing material, or destructive file operations.

Use GitHub's private vulnerability reporting feature for this repository when available. If private reporting is not enabled, contact the repository owner privately and include:

- affected version or commit
- reproduction steps
- expected and actual behavior
- impact assessment
- logs or screenshots with secrets and personal paths removed

Do not include API tokens, passwords, signing certificates, private media filenames, or full local/network paths in reports.

## Security Boundaries

This application is a local Windows desktop application with destructive file capabilities. Security-sensitive areas include:

- permanent delete, move, and rename operations
- Electron preload and IPC boundaries
- CloudDrive API credentials and remote file deletion
- installer and code-signing workflow
- subtitle provider credentials and network requests
- diagnostic export and log redaction

Changes in these areas require explicit review and regression tests.

## Credential Handling

Secrets must never be committed to the repository or written to normal logs. Local credentials should be stored using operating-system-backed secure storage where available.

If a credential is ever committed, deleting it from the working tree is not sufficient. Rotate the credential first, then assess Git history cleanup.

## Release Safety

Official releases must:

1. pass the repository release gates
2. be built from a protected revision or tag
3. use least-privilege GitHub Actions permissions
4. keep signing credentials scoped to the signing step only
5. publish checksums with the installer
