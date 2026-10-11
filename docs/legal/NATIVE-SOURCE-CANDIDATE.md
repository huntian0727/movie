# Source-built native tools: private QA candidate

This document applies when `build-flavor.json` selects
`playerRuntimeVariant: source-candidate` or `mediaVariant: source-candidate`.
The historical mpv binary described in `MPV_SOURCE_NOTICE.md` is not the player
binary in the source player candidate. Historical FFmpeg Lite materials apply
to `lite-candidate`, not to the source media selection described here.

Public redistribution remains blocked. Neither a matching hash nor successful
playback sets `approved` or `sourceComplianceApproved` to true.

- Producer: https://github.com/huntian0727/movie/actions/runs/38134981406
- Movie build commit: `dac070da604a12acb2eeedccb4993f1ebc52e001`.
- mpv source commit: `d94d09581474d6e91d7a0e544b07de4eb8b07a9f`.
- Runtime-reported version: `mpv v0.41.0-UNKNOWN` (the source archive has no Git directory).
- Original private runtime ZIP SHA-256:
  `3b4b4d22a3cf303b05898dedd470a6f05b0bfaa532c4ca9ab481167cd8f21b99`.
- Retained source/toolchain evidence ZIP SHA-256:
  `3e242199da78c68939ebcbc8bb70bae4c2e57102b7aadc5ceb6b54317880e70a`.
- Original binary/source map SHA-256:
  `d7909841833d0626547eaf8340377f402631ba65ce739bbfa8fd18da95ddfe4e`.

The producer completed compilation but its overall CI conclusion is **FAIL**:
the packer did not recognize `CFGMGR32.dll` and `SHCORE.dll` as Windows system
imports. The unchanged map records `closureValid: false`. Local verification
compared the actual PE imports and hashes of all 26 producer binaries, verified
the two Microsoft-signed System32 components, and found no remaining unknown
dependencies. Those system files are not copied into the application.

Private QA packages copy the 24 DLLs and three upstream mpv notice files pinned
in `scripts/native-source-player-runtime.lock.json`. The separately selected
`mediaVariant: source-candidate` copies FFmpeg.exe, FFprobe.exe and their exact
12 DLL dependency closure from the same retained producer ZIP, pinned in
`scripts/native-source-media.lock.json`. Every overlapping DLL has the same
bytes as the player dependency. The other media variants remain unchanged.

The source media selection uses shared FFmpeg `git-2026-10-11-b5902e6`, with
GPL/nonfree disabled and corresponding source/toolchain evidence retained in
the same source ZIP listed above. It ships the exact upstream
`COPYING.LGPLv2.1` as `media-tools/LICENSE.txt` and
`legal/FFMPEG-SOURCE-CANDIDATE-LICENSE.txt`. Full dependent-library notices are
in `NATIVE-SOURCE-CANDIDATE-NOTICES.txt`. Private QA only: staging and successful
probe/thumbnail tests do not approve redistribution.

Actual build options include mpv `gpl=false`, shared libmpv, libass, LuaJIT and
D3D11; JavaScript and subrandr are disabled. FFmpeg in this player's dependency
tree has GPL and nonfree disabled. The complete evidence contains 25 archived
build inputs, recursive source revisions, exact FFmpeg/mpv configuration,
compiler metadata and GCC 13.2.0-6ubuntu1 source archives. Source retention and
these options are evidence for review, not an automatic license conclusion.

Collected review materials are in `NATIVE-SOURCE-CANDIDATE-NOTICES.txt` and
`NATIVE-SOURCE-CANDIDATE-REVIEW-INDEX.json`: 95 source notice records,
70 distinct full texts, including FreeType FTL/credit, GCC runtime exception,
winpthreads and inline AMD/NVIDIA notices. The index covers 16 producer binary
component groups, plus LuaJIT statically linked into mpv. This collection also
includes retained unlinked source/test inputs; it is not a concluded SPDX
license assignment. The private source review companion ZIP SHA-256 is
`b0caa9b90695515b97ddae5de7b3569ea1f867a09d2680ec488f81fa3770b77f`.

Before public distribution: review component-specific applicability and
the source companion, approve the exact binary/source relationship, run stable Windows
11 ordinary-user QA for the final public identity, and use the existing formal
release gate. Source candidates are currently rejected by that gate.
