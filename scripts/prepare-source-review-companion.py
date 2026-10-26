"""Build private source/notices review materials; no program or approval changes."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE_SHA256 = "3e242199da78c68939ebcbc8bb70bae4c2e57102b7aadc5ceb6b54317880e70a"
SOURCE_BYTES = 255050585
NATIVE_SHA256 = "3b4b4d22a3cf303b05898dedd470a6f05b0bfaa532c4ca9ab481167cd8f21b99"
ASSETS = ["LICENSE", "package-lock.json", "scripts/native-source-media.lock.json",
          "scripts/native-source-player-runtime.lock.json", "native/embedded-mpv/NativeHost.cs",
          "scripts/build-native-player.mjs", "scripts/native-player-toolchain.mjs", "scripts/native-player-toolchain.lock.json",
          "scripts/restore-native-source-inputs.py", "scripts/audit-native-source-licenses.py",
          "docs/legal/NATIVE-SOURCE-CANDIDATE.md", "docs/legal/NATIVE-SOURCE-CANDIDATE-NOTICES.txt",
          "docs/legal/NATIVE-SOURCE-CANDIDATE-REVIEW-INDEX.json", "docs/legal/NATIVE-SOURCE-COMPILED-NOTICES.txt",
          "docs/legal/NATIVE-SOURCE-COMPILE-REVIEW.json", "docs/legal/NATIVE-SOURCE-DISTRIBUTION-REVIEW.md",
          "docs/legal/GNU-GPLv3.txt", "docs/legal/GNU-LGPLv3.txt"]

def read_json(file):
    return json.loads(Path(file).read_text(encoding="utf-8"))

def digest(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def verify_source_zip(source):
    source = Path(source)
    if source.is_symlink() or not source.is_file() or source.stat().st_size != SOURCE_BYTES or digest(source) != SOURCE_SHA256:
        raise ValueError("Corresponding-source ZIP differs from fixed producer")
    with zipfile.ZipFile(source) as archive:
        for item in archive.infolist():
            name = item.orig_filename
            p = PurePosixPath(name)
            if p.is_absolute() or ".." in p.parts or "\\" in name or p.suffix.lower() in {".exe", ".dll", ".nupkg", ".so", ".a"}:
                raise ValueError("Unsafe/non-source top-level input")
        if archive.testzip() is not None:
            raise ValueError("Source ZIP CRC failure")

def validate_public_test(approval, version, native_approval):
    import re
    if not re.fullmatch(r"\d+\.\d+\.\d+-beta\.\d+", version) or approval.get("version") != version or approval.get("approved") is not True or approval.get("scope") != "public-prerelease-portable-only" or approval.get("stableReleaseApproved") is not False:
        raise ValueError("Public source companion requires exact approved beta scope")
    if native_approval.get("approved") is not True or not native_approval.get("binaries") or any(item.get("sourceComplianceApproved") is not True for item in native_approval["binaries"]):
        raise ValueError("Public source companion lacks native distribution approval")

def validate_stable_release(approval, version, native_approval):
    if (approval.get("approved") is not True or approval.get("ownersConfirmed") is not True or
        approval.get("manualQaApproved") is not True or approval.get("scope") != "stable-portable-only" or
        approval.get("version") != version or approval.get("applicationLicense") != "MIT" or
        approval.get("unsignedAcknowledged") is not True or approval.get("stableWindowsCoverage") is not False or
        approval.get("standardUserCoverage") is not False):
        raise ValueError("Stable source companion requires the exact owner-approved portable scope")
    if (native_approval.get("approved") is not True or len(native_approval.get("binaries", [])) != 39 or
        any(item.get("sourceComplianceApproved") is not True for item in native_approval["binaries"])):
        raise ValueError("Stable source companion lacks exact native source approval")

def archive_application_sources(root, commit, output):
    tree = subprocess.check_output(["git", "rev-parse", commit + "^{tree}"], cwd=root, text=True).strip()
    subprocess.run(["git", "archive", "--format=zip", "--mtime=2000-01-01T00:00:00Z", "--output=" + str(output), tree], cwd=root, check=True)

def prepare(source, output, public_test=False, stable_release=False):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output == ROOT or ROOT in output.parents or output.exists() or not output.parent.is_dir():
        raise ValueError("Output must be a NEW external staging directory with existing parent")
    if public_test and stable_release:
        raise ValueError("Choose one release scope")
    verify_source_zip(source)
    native_zip = ROOT / ".tmp/native-source-inputs/native-runtime.zip"
    if native_zip.is_symlink() or not native_zip.is_file() or native_zip.stat().st_size != 39814033 or digest(native_zip) != NATIVE_SHA256:
        raise ValueError("Native runtime ZIP differs from the approved fixed producer")
    approvals = [read_json(ROOT / p) for p in ["build/release-approval.json", "build/native-source-approval.json"]]
    if any(type(a.get("approved")) is not bool for a in approvals):
        raise ValueError("Approval records have invalid state")
    media, player = [read_json(ROOT / p) for p in ["scripts/native-source-media.lock.json", "scripts/native-source-player-runtime.lock.json"]]
    if any(lock.get("archiveSha256") != NATIVE_SHA256 or lock.get("sourceEvidenceZipSha256") != SOURCE_SHA256 for lock in [media, player]) or approvals[1].get("nativeArchiveSha256") != NATIVE_SHA256:
        raise ValueError("Review inputs do not match the exact runtime pair")
    host = next((b for b in approvals[1]["binaries"] if b["path"] == "native-player/NativeHost.exe"), None)
    if not host or digest(ROOT / "native-bin/NativeHost.exe") != host["sha256"]:
        raise ValueError("NativeHost binary differs from the source review record")
    for file in ASSETS:
        p = ROOT / file
        if p.is_symlink() or not p.is_file():
            raise ValueError("Review material missing or linked: " + file)
    review = read_json(ROOT / "docs/legal/NATIVE-SOURCE-COMPILE-REVIEW.json")
    if review["approved"] is not False or len(review["compiledSources"]) != 244 or review["gplOnlyCompiledSources"]:
        raise ValueError("Compilation review differs")
    if digest(ROOT / "docs/legal/NATIVE-SOURCE-COMPILED-NOTICES.txt") != review["noticeFileSha256"]:
        raise ValueError("Supplemented notice bytes differ")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    # Avoid presenting a dirty source snapshot as a committed version.
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT):
        raise ValueError("Commit reviewed files before companion staging")
    version = read_json(ROOT / "package.json")["version"]
    if public_test:
        validate_public_test(read_json(ROOT / "build/public-test-approval.json"), version, approvals[1])
    if stable_release:
        validate_stable_release(approvals[0], version, approvals[1])
        qa = read_json(ROOT / "docs/legal/PORTABLE_RELEASE_QA.json")
        if (qa.get("status") != "PASS_OWNER_ACCEPTED_TARGETED_PORTABLE_QA" or qa.get("version") != version or
            qa.get("nativeHostBinarySha256") != host["sha256"] or qa.get("ownerAcceptedEnvironment") is not True):
            raise ValueError("Targeted QA record does not match the approved NativeHost/version")
    if not all(c.isalnum() or c in ".-" for c in version):
        raise ValueError("Unsafe package version")
    output.mkdir()
    application_sources = output / ("Movie-" + version + "-Application-Sources.zip")
    archive_application_sources(ROOT, commit, application_sources)
    bundle = output / ("Movie-Native-Runtime-" + version + "-Corresponding-Sources.zip" if stable_release else
                      "Movie-" + version + ("-Corresponding-Native-Sources.zip" if public_test else "-Native-Source-Review.zip"))
    public_assets = ["THIRD_PARTY_LICENSES.md", "docs/legal/THIRD_PARTY_RELEASE_NOTICES.md",
        "docs/legal/FFMPEG_BUILD_INFO.md", "docs/legal/FFMPEG_SOURCE_NOTICE.md",
        "docs/legal/NATIVE_COMPONENTS.md", "docs/legal/MPV_SOURCE_NOTICE.md"]
    if public_test:
        release_assets = ASSETS + ["build/public-test-approval.json", "build/native-source-approval.json",
            "docs/legal/PUBLIC_TEST_RELEASE_DECISION.md"] + public_assets
    elif stable_release:
        release_assets = ASSETS + ["build/native-source-approval.json", "docs/legal/PORTABLE_RELEASE_QA.json",
            "docs/legal/STABLE_PORTABLE_RELEASE_DECISION.md"] + public_assets
    else:
        release_assets = ASSETS
    assets = [{"path": file, "sha256": digest(ROOT / file)} for file in release_assets]
    status = {"schemaVersion": 1, "status": "PRIVATE_REVIEW_NOT_PUBLIC_RELEASE", "approved": False,
              "programIncluded": False, "sourceComplianceApproved": False, "version": version, "applicationCommitBoundExternally": True,
              "inputApprovalStates": [a["approved"] for a in approvals], "nativeRuntimeInputSha256": NATIVE_SHA256,
              "nativeSourceInputSha256": SOURCE_SHA256, "nativeSourceInputBytes": SOURCE_BYTES,
              "applicationSourcesSha256": digest(application_sources), "assets": assets}
    if public_test:
        status.update(status="PUBLIC_PRERELEASE_CORRESPONDING_SOURCES", approved=True, sourceComplianceApproved=True,
                      stableReleaseApproved=False, nativeLicenseElection="LGPL-3.0-or-later")
    elif stable_release:
        status.update(status="STABLE_PORTABLE_CORRESPONDING_SOURCES", approved=True, sourceComplianceApproved=True,
                      stableReleaseApproved=True, scope="stable-portable-only", nativeLicenseElection="LGPL-3.0-or-later",
                      stableWindowsCoverage=False, standardUserCoverage=False,
                      nativeHostSha256=host["sha256"])
    with zipfile.ZipFile(bundle, "w") as archive:
        archive.write(source, "retained-native-sources.zip", compress_type=zipfile.ZIP_STORED)
        for file in release_assets:
            archive.write(ROOT / file, "review/" + file, compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("REVIEW-STATUS.json", json.dumps(status, indent=2), compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("README.txt", (
            "Corresponding sources for the approved stable portable release; not stable-system certification.\n"
            if stable_release else
            "Corresponding sources for the approved public beta; not stable-system certification.\n"
            if public_test else "Private review companion, not a release or legal approval.\n") +
            ("LGPL later-version components are distributed under LGPLv3 compliance conditions.\n"
             "You may replace compatible shared DLLs and reverse engineer the application to debug modified libraries.\n"
             if public_test or stable_release else "") +
            "No application/native executable is included. Original source inputs keep their own licenses.\n"
            "Extract retained-native-sources.zip, then use review/scripts/restore-native-source-inputs.py\n"
            "with its native-source-candidate/evidence directory and a NEW disposable Linux directory.\n"
            "Install the retained toolchain/build versions before rebuilding; bit-identical output is not certified.\n"
            "NativeHost source and pinned build/compiler metadata are in review/native and review/scripts.\n"
            "The application source ZIP alongside this archive binds the exact repository commit.\n"
            "Follow the component distribution review for notices and shared-library replacement.\n"
            "Public beta program and both matching source archives are downloadable together, without charge, from the same GitHub Release.\n")
    with zipfile.ZipFile(bundle) as archive:
        if archive.testzip() is not None:
            raise ValueError("Companion ZIP CRC failure")
    sums = "".join(digest(p) + "  " + p.name + "\n" for p in [application_sources, bundle])
    (output / "SHA256SUMS.txt").write_text(sums, encoding="utf8")
    status["companionSha256"] = digest(bundle)
    status["companionBytes"] = bundle.stat().st_size
    (output / "REVIEW-STATUS.json").write_text(json.dumps(status, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"output": str(output), "commit": commit, "bytes": status["companionBytes"], "sha256": status["companionSha256"], "approved": status["approved"]}))
    return status

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-zip", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--public-test", action="store_true")
    parser.add_argument("--stable-release", action="store_true")
    args = parser.parse_args()
    prepare(args.source_zip, args.output_dir, args.public_test, args.stable_release)
