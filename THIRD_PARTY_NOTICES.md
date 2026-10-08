# Third-Party Notices

This file is a release-preparation scaffold. It is **not yet a complete legal notice set**.

Before distributing binaries, verify the exact versions and licenses of all bundled runtime dependencies and include any notices, source offers, attribution, or license text required by those licenses.

## Known component requiring explicit review

### FFmpeg

This project currently depends on `ffmpeg-static`, which may bundle FFmpeg binaries under GPL terms depending on the package build.

Before an official binary release:

1. verify the exact bundled FFmpeg build and its enabled components
2. confirm the applicable FFmpeg license for that build
3. satisfy the corresponding source-code and notice obligations
4. confirm that the chosen license for this project is compatible with the planned distribution model

Do not treat this scaffold as legal advice or as proof of compliance.

## Other dependencies

The exact dependency set is pinned by `package-lock.json`. Generate a dependency license report as part of release preparation and review any copyleft, attribution, binary redistribution, font, icon, or media requirements.
