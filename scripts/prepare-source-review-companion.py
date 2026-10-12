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

def prepare(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output == ROOT or ROOT in output.parents or output.exists() or not output.parent.is_dir():
        raise ValueError("Output must be a NEW external staging directory with existing parent")
    verify_source_zip(source)
    approvals = [json.loads((ROOT / p).read_text()) for p in ["build/release-approval.json", "build/native-source-approval.json"]]
    if any(type(a.get("approved")) is not bool for a in approvals):
        raise ValueError("Approval records have invalid state")
    media, player = [json.loads((ROOT / p).read_text()) for p in ["scripts/native-source-media.lock.json", "scripts/native-source-player-runtime.lock.json"]]
    if any(lock.get("archiveSha256") != NATIVE_SHA256 or lock.get("sourceEvidenceZipSha256") != SOURCE_SHA256 for lock in [media, player]) or approvals[1].get("nativeArchiveSha256") != NATIVE_SHA256:
        raise ValueError("Review inputs do not match the exact runtime pair")
    host = next((b for b in approvals[1]["binaries"] if b["path"] == "native-player/NativeHost.exe"), None)
    if not host or digest(ROOT / "native-bin/NativeHost.exe") != host["sha256"]:
        raise ValueError("NativeHost binary differs from the source review record")
    for file in ASSETS:
        p = ROOT / file
        if p.is_symlink() or not p.is_file():
            raise ValueError("Review material missing or linked: " + file)
    review = json.loads((ROOT / "docs/legal/NATIVE-SOURCE-COMPILE-REVIEW.json").read_text())
    if review["approved"] is not False or len(review["compiledSources"]) != 244 or review["gplOnlyCompiledSources"]:
        raise ValueError("Compilation review differs")
    if digest(ROOT / "docs/legal/NATIVE-SOURCE-COMPILED-NOTICES.txt") != review["noticeFileSha256"]:
        raise ValueError("Supplemented notice bytes differ")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    # Avoid presenting a dirty source snapshot as a committed version.
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT):
        raise ValueError("Commit reviewed files before companion staging")
    version = json.loads((ROOT / "package.json").read_text())["version"]
    if not all(c.isalnum() or c in ".-" for c in version):
        raise ValueError("Unsafe package version")
    output.mkdir()
    application_sources = output / ("Movie-" + version + "-Application-Sources.zip")
    subprocess.run(["git", "archive", "--format=zip", "--output=" + str(application_sources), commit], cwd=ROOT, check=True)
    bundle = output / ("Movie-" + version + "-Native-Source-Review.zip")
    assets = [{"path": file, "sha256": digest(ROOT / file)} for file in ASSETS]
    status = {"schemaVersion": 1, "status": "PRIVATE_REVIEW_NOT_PUBLIC_RELEASE", "approved": False,
              "programIncluded": False, "sourceComplianceApproved": False, "version": version, "commit": commit,
              "inputApprovalStates": [a["approved"] for a in approvals], "nativeRuntimeInputSha256": NATIVE_SHA256,
              "nativeSourceInputSha256": SOURCE_SHA256, "nativeSourceInputBytes": SOURCE_BYTES,
              "applicationSourcesSha256": digest(application_sources), "assets": assets}
    with zipfile.ZipFile(bundle, "w") as archive:
        archive.write(source, "retained-native-sources.zip", compress_type=zipfile.ZIP_STORED)
        for file in ASSETS:
            archive.write(ROOT / file, "review/" + file, compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("REVIEW-STATUS.json", json.dumps(status, indent=2), compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("README.txt", "Private review companion, not a release or legal approval.\n"
            "No application/native executable is included. Original source inputs keep their own licenses.\n"
            "Extract retained-native-sources.zip, then use review/scripts/restore-native-source-inputs.py\n"
            "with its native-source-candidate/evidence directory and a NEW disposable Linux directory.\n"
            "Install the retained toolchain/build versions before rebuilding; bit-identical output is not certified.\n"
            "NativeHost source and pinned build/compiler metadata are in review/native and review/scripts.\n"
            "The application source ZIP alongside this archive binds the exact repository commit.\n"
            "Follow the component distribution review for notices, shared-library replacement and eventual public source access.\n")
    with zipfile.ZipFile(bundle) as archive:
        if archive.testzip() is not None:
            raise ValueError("Companion ZIP CRC failure")
    sums = "".join(digest(p) + "  " + p.name + "\n" for p in [application_sources, bundle])
    (output / "SHA256SUMS.txt").write_text(sums, encoding="utf8")
    status["companionSha256"] = digest(bundle)
    status["companionBytes"] = bundle.stat().st_size
    (output / "REVIEW-STATUS.json").write_text(json.dumps(status, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"output": str(output), "commit": commit, "bytes": status["companionBytes"], "sha256": status["companionSha256"], "approved": False}))
    return status

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-zip", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    prepare(args.source_zip, args.output_dir)
