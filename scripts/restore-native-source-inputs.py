"""Restore captured native sources without resolving floating upstream refs.

Creates a NEW disposable tree only. It does not compile, replace native-bin,
grant approval, or promise a bit-identical rebuild. Run rebuild.sh on Linux
with the toolchain versions recorded alongside the source evidence.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import shlex
import sys
import tarfile


def digest(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def checked_archive(evidence, row):
    name = row["archive"]
    if Path(name).name != name or "/" in name or "\\" in name:
        raise ValueError("Unsafe source archive name")
    file = evidence / name
    if not file.is_file() or file.is_symlink() or file.stat().st_size != row["bytes"] or digest(file) != row["sha256"]:
        raise ValueError("Source archive identity mismatch: " + name)
    with tarfile.open(file) as tar:
        roots = set()
        for member in tar:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or "\\" in member.name or not path.parts:
                raise ValueError("Unsafe source member path")
            roots.add(path.parts[0])
        if len(roots) != 1:
            raise ValueError("Expected one source tree root")
    return file, next(iter(roots))


def restore(evidence, destination):
    evidence = Path(evidence).resolve()
    destination = Path(destination).resolve()
    if destination.exists() or evidence == destination or evidence in destination.parents:
        raise ValueError("Restore destination must be new and outside the evidence")
    manifest = json.loads((evidence / "inputs.json").read_text(encoding="utf8"))
    if manifest.get("schemaVersion") != 1 or manifest.get("approved") is not False:
        raise ValueError("Expected unapproved source capture manifest")
    rows = manifest["inputs"]
    if len({row["name"] for row in rows}) != len(rows):
        raise ValueError("Duplicate source input")
    if any(row["kind"] not in {"pinned-source", "download", "pre-build-source-tree"} or
           (row["kind"] == "pinned-source" and row["name"] != "mpv") for row in rows):
        raise ValueError("Unknown captured input kind")
    # Verify ALL bytes and member paths before creating any output.
    archives = [(row, *checked_archive(evidence, row)) for row in rows]
    mpv = [item for item in archives if item[0]["name"] == "mpv" and item[0]["kind"] == "pinned-source"]
    if len(mpv) != 1 or mpv[0][2] != "mpv-" + mpv[0][0]["commit"]:
        raise ValueError("Missing exact mpv source input")
    recipe = (evidence / "movie-build-mingw64.sh").read_text(encoding="utf8")
    collector = evidence / "source-capture.py"
    if not recipe.startswith("export SOURCE_CAPTURE=") or not collector.is_file():
        raise ValueError("Captured build recipe/helper missing")
    destination.mkdir(parents=True)
    with tarfile.open(mpv[0][1]) as tar:
        tar.extractall(destination, filter="data")
    tree = destination / "mpv"
    (destination / mpv[0][2]).rename(tree)
    captured_roots = {root for row, _, root in archives if row["kind"] == "pre-build-source-tree"}
    for row, file, root in archives:
        if row["name"] == "mpv":
            continue
        if row["kind"] not in {"download", "pre-build-source-tree"}:
            raise ValueError("Unknown captured input kind")
        if row["kind"] == "download" and root in captured_roots:
            continue  # Prefer the actual pre-build tree, including nested deps.
        if (tree / root).exists():
            raise ValueError("Source tree collision: " + root)
        with tarfile.open(file) as tar:
            tar.extractall(tree, filter="data")
    local_collector = destination / "source-capture.py"
    local_collector.write_bytes(collector.read_bytes())
    helper = destination / "source-capture"
    helper.write_text('#!/bin/sh\nexec python3 ' + shlex.quote(str(local_collector)) + ' "$@"\n', encoding="utf8", newline="\n")
    helper.chmod(0o755)
    # Only relocate the collector path; retain every captured build option.
    recipe = "export SOURCE_CAPTURE=" + shlex.quote(str(helper)) + "\n" + recipe.partition("\n")[2]
    (tree / "ci/build-mingw64.sh").write_text(recipe, encoding="utf8", newline="\n")
    rebuild = destination / "rebuild.sh"
    rebuild.write_text("#!/bin/sh\nset -eu\nexport SOURCE_EVIDENCE_DIR=" + shlex.quote(str(evidence)) +
                       "\nexport SOURCE_BUILD_ROOT=" + shlex.quote(str(tree)) +
                       "\nexport TARGET=x86_64-w64-mingw32 RUST_TARGET=x86_64-pc-windows-gnu BUILD_JOBS=2\n" +
                       "cd " + shlex.quote(str(tree)) + "\nbash ci/build-mingw64.sh meson\n", encoding="utf8", newline="\n")
    rebuild.chmod(0o755)
    result = {"schemaVersion": 1, "approved": False, "inputsVerified": len(rows),
              "sourceManifestSha256": digest(evidence / "inputs.json"), "sourceTree": str(tree),
              "rebuildScript": str(rebuild), "compiled": False, "bitIdenticalRebuildVerified": False,
              "recipeModification": "Relocated source collector path only"}
    (destination / "restoration.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
    print(json.dumps(result))
    return result


if __name__ == "__main__":
    restore(*sys.argv[1:])
