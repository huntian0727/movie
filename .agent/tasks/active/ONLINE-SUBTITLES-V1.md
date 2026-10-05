# ONLINE-SUBTITLES-V1

- Workflow: FULL
- Risk Areas: credentials/network and IPC security, playback session isolation, persistent subtitle assets, desktop release
- QA Required: YES (independent source/test review)
- UI Required: YES (independent interaction review plus real desktop validation)
- Web Advisor Required: NO (official API contracts verified locally; no external adviser messaging authorized)
- Workflow Reason: new authenticated network service and playback integration cross a security boundary.
- Status: LOCAL_ACCEPTANCE_COMPLETE
- Owner: local developer; PM routing is handled in this chat.
- Authorization: user explicitly requested development of the previously discussed subtitle search/download plan.
- Checkpoint: 2026-10-05_10-12-26-522_online-subtitles-v1; checkpoint-20261005-181222-82efc99-online-subtitles-v1
- Scope: ASSRT/OpenSubtitles API configuration, on-demand search and candidate selection, SRT/ASS download and validation, durable associations, automatic loading, offset adjustment and export. Existing embedded/native player UI and IPC contracts remain authoritative.
- Out of scope: AI generation/translation, arbitrary site scraping, whole-library automatic jobs, modifying source videos, CloudDrive/scanning/schema rewrites.
- Acceptance: no secrets read back to renderer/logs; renderer passes IDs rather than paths/URLs; bounded network responses and trusted download hosts; persisted subtitles survive cache cleanup/restart; old video/session responses cannot alter new playback; provider outage differs from no results; subtitle failure does not stop video playback.
- Tests: focused provider/service/IPC/credential/renderer/session regressions; project release gate; Electron and packaged smoke in isolated ABI checkout; rebuild desktop package and launch verified desktop shortcut.
- Reviewed implementation: 9480d87d7aedb4a2ba8ba01ce3845ca6aeb62192; Developer DEV_COMPLETE, independent QA PASS_WITH_KNOWN_RISKS, independent UI UI_REVIEW_PASS.
- Verification: release gate 111 suites / 964 tests; Electron smoke/artifact and real MPV isolation PASS; actual desktop Settings/search/modal acceptance PASS. Live authenticated download NOT RUN.
- Next Actor: Local PM executes normal finish-and-push, rebuilds final documented commit, verifies final packaged smoke and original desktop shortcut. Delivery details in docs/ai/deliveries/2026-10-05-online-subtitles-v1.md.
