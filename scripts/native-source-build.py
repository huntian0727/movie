"""Isolated, source-retaining Windows LGPL candidate build. Never changes native-bin.

Uses a fixed upstream dynamic MinGW recipe. Every dependency tree is saved before
its first build, including nested git checkouts. Approval remains a separate step.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request

MPV_COMMIT = "d94d09581474d6e91d7a0e544b07de4eb8b07a9f"
RECIPE_SHA = "22a98842b121a8a947b1703251bd72b4f553ff4fd91a5894202af156539a3ea2"
COMMON_SHA = "26d7b132e0904f76b45081d6c3734d3a6f78815ddb9a0f910263def18fceea89"


def digest(file):
    h = hashlib.sha256()
    with Path(file).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError("Pinned recipe structure changed: " + old[:70])
    return text.replace(old, new, 1)


def patch_recipe(raw, helper):
    if hashlib.sha256(raw).hexdigest() != RECIPE_SHA:
        raise ValueError("Upstream recipe bytes differ")
    text = raw.decode()
    text = replace_once(text, 'wget="wget --progress=bar:force"', 'wget="wget --progress=bar:force --timeout=45 --tries=2"')
    # Keep dynamic linking; remove GPL, Rust subtitle renderer and JS scripting.
    # libass and LuaJIT remain available. These features need candidate QA.
    text = replace_once(text, "--target-os=mingw32 --enable-gpl", "--target-os=mingw32 --disable-gpl --disable-nonfree")
    text = replace_once(text, "--disable-{doc,programs}", "--disable-doc")
    text = replace_once(text, "    build_if_missing subrandr\n", "    : # Source-retaining baseline uses libass, without Rust subrandr\n")
    text = replace_once(text, "    --force-fallback-for=mujs\n    -Dmujs:werror=false\n    -Dmujs:default_library=static\n", "    -Dgpl=false -Djavascript=disabled -Dsubrandr=disabled\n")
    text = replace_once(text, "-D{amf,shaderc,spirv-cross,d3d11,javascript,libcurl}=enabled", "-D{amf,shaderc,spirv-cross,d3d11,libcurl}=enabled")
    # No cache is restored: a build must not use undocumented precompiled inputs.
    text = replace_once(text, "    [ -d \"$1/builddir\" ] && rm -rf \"$1/builddir\"", '    "$SOURCE_CAPTURE" checkpoint "$1"\n    [ -d "$1/builddir" ] && rm -rf "$1/builddir"')
    text = replace_once(text, "    tar -xaf \"$fname\" || return 1", '    "$SOURCE_CAPTURE" download "$1" "$fname"\n    tar -xaf "$fname" || return 1')
    text = replace_once(text, "    pushd nv-codec-headers", '    "$SOURCE_CAPTURE" checkpoint nv-codec-headers\n    pushd nv-codec-headers')
    text = replace_once(text, "    pushd LuaJIT", '    "$SOURCE_CAPTURE" checkpoint LuaJIT\n    pushd LuaJIT')
    # Reduce peak memory on the two-core Actions runner.
    text = text.replace("ninja\n", 'ninja -j "${BUILD_JOBS:-2}"\n')
    text = replace_once(text, "meson compile -C $build", 'meson compile -C $build -j "${BUILD_JOBS:-2}"')
    text = text.replace("make -j$(nproc)", 'make -j"${BUILD_JOBS:-2}"')
    text = "export SOURCE_CAPTURE=" + json.dumps(str(helper)) + "\n" + text
    return text


def manifest_root():
    return Path(os.environ["SOURCE_EVIDENCE_DIR"]).resolve()


def record(entry):
    output = manifest_root()
    file = output / "inputs.json"
    data = json.loads(file.read_text()) if file.exists() else {"schemaVersion": 1, "approved": False, "inputs": []}
    if any(row["name"] == entry["name"] for row in data["inputs"]):
        raise ValueError("Duplicate source input: " + entry["name"])
    data["inputs"].append(entry)
    file.write_text(json.dumps(data, indent=2) + "\n")


def safe_name(name):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", name) or name in {".", ".."}:
        raise ValueError("Unsafe source name")
    return name


def verify_existing_input(file):
    manifest = manifest_root() / "inputs.json"
    if not manifest.is_file():
        raise ValueError("Existing source archive has no recorded identity")
    matches = [row for row in json.loads(manifest.read_text())["inputs"] if row["archive"] == file.name]
    if len(matches) != 1 or matches[0]["sha256"] != digest(file) or matches[0]["bytes"] != file.stat().st_size:
        raise ValueError("Existing source archive differs from its recorded identity")


def checkpoint(source):
    tree = Path(source).resolve()
    # Only directories below the disposable build source root are accepted.
    base = Path(os.environ["SOURCE_BUILD_ROOT"]).resolve()
    if tree == base or base not in tree.parents or not tree.is_dir():
        raise ValueError("Source tree outside build root")
    name = safe_name(tree.name)
    archive = manifest_root() / (name + ".tar.gz")
    if archive.exists():
        verify_existing_input(archive)
        return  # The first checkpoint is the actual input, before compilation.
    git_rows = []
    for git_path in tree.rglob(".git"):
        if not git_path.exists() or any(p in {"builddir", "mingw_build"} for p in git_path.parts):
            continue
        cwd = git_path.parent
        revision = subprocess.check_output(["git", "-C", str(cwd), "rev-parse", "HEAD"], text=True).strip()
        origin = subprocess.check_output(["git", "-C", str(cwd), "remote", "get-url", "origin"], text=True).strip()
        if not origin.startswith("https://") or "@" in origin:
            raise ValueError("Unexpected authenticated/non-HTTPS source origin")
        git_rows.append({"path": str(cwd.relative_to(tree)), "commit": revision, "origin": origin})
    git_rows = list({row["path"]: row for row in git_rows}.values())

    def source_filter(info):
        parts = Path(info.name).parts
        if any(x in {".git", "builddir", "mingw_build", "__pycache__"} for x in parts):
            return None
        return info

    temporary = archive.with_suffix(".partial")
    with tarfile.open(temporary, "w:gz") as tar:
        tar.add(tree, arcname=name, filter=source_filter)
    temporary.rename(archive)
    record({"name": name, "kind": "pre-build-source-tree", "archive": archive.name,
            "sha256": digest(archive), "bytes": archive.stat().st_size, "git": git_rows})


def capture_download(url, source):
    if not url.startswith("https://") or "@" in url:
        raise ValueError("Unexpected source URL")
    source = Path(source).resolve()
    if not source.is_file() or source.is_symlink():
        raise ValueError("Expected downloaded regular file")
    name = "download-" + digest(source) + "-" + safe_name(source.name)
    destination = manifest_root() / name
    if destination.exists():
        verify_existing_input(destination)
        return
    shutil.copyfile(source, destination)
    record({"name": name, "kind": "download", "url": url, "archive": name,
            "sha256": digest(destination), "bytes": destination.stat().st_size})


def bootstrap(work):
    if sys.platform != "linux":
        raise ValueError("Cross build only runs in the disposable Linux CI runner")
    work = Path(work).resolve()
    if work.exists():
        raise ValueError("Build workspace must be new, without cached inputs")
    work.mkdir(parents=True)
    evidence = work / "evidence"
    evidence.mkdir()
    os.environ["SOURCE_EVIDENCE_DIR"] = str(evidence)
    os.environ["SOURCE_BUILD_ROOT"] = str(work / "mpv")
    archive = evidence / "mpv-source.tar.gz"
    url = "https://codeload.github.com/mpv-player/mpv/tar.gz/" + MPV_COMMIT
    with urllib.request.urlopen(url, timeout=120) as response, archive.open("wb") as out:
        shutil.copyfileobj(response, out)
    with tarfile.open(archive) as tar:
        tar.extractall(work, filter="data")
    tree = work / ("mpv-" + MPV_COMMIT)
    tree.rename(work / "mpv")
    tree = work / "mpv"
    recipe = tree / "ci/build-mingw64.sh"
    common = tree / "ci/build-common.sh"
    if digest(common) != COMMON_SHA:
        raise ValueError("Upstream common recipe bytes differ")
    record({"name": "mpv", "kind": "pinned-source", "commit": MPV_COMMIT,
            "url": url, "archive": archive.name, "sha256": digest(archive), "bytes": archive.stat().st_size})
    # An executable wrapper makes each checkpoint independent of shell quoting.
    helper = work / "source-capture"
    helper.write_text('#!/bin/sh\nexec python3 "' + str(Path(__file__).resolve()) + '" "$@"\n')
    helper.chmod(0o755)
    raw = recipe.read_bytes()
    patched = patch_recipe(raw, helper)
    (evidence / "upstream-build-mingw64.sh").write_bytes(raw)
    (evidence / "movie-build-mingw64.sh").write_text(patched)
    (evidence / "source-capture.py").write_bytes(Path(__file__).read_bytes())
    recipe.write_text(patched)
    env = {**os.environ, "TARGET": "x86_64-w64-mingw32", "RUST_TARGET": "x86_64-pc-windows-gnu", "BUILD_JOBS": "2",
           "GIT_HTTP_LOW_SPEED_LIMIT": "1024", "GIT_HTTP_LOW_SPEED_TIME": "90"}
    subprocess.run(["bash", str(recipe), "meson"], cwd=tree, env=env, check=True)
    # Record exact configurations and import tables before selecting DLL closure.
    shutil.copyfile(tree / "ffmpeg/builddir/ffbuild/config.log", evidence / "ffmpeg-config.txt")
    shutil.copyfile(tree / "mingw_build/meson-info/intro-buildoptions.json", evidence / "mpv-buildoptions.json")
    pack_runtime(work)


SYSTEM_DLLS = {"advapi32.dll", "avrt.dll", "bcrypt.dll", "comctl32.dll", "comdlg32.dll", "crypt32.dll", "d3d11.dll", "d3d12.dll", "d3dcompiler_47.dll", "dnsapi.dll", "dwmapi.dll", "dwrite.dll", "dxgi.dll", "gdi32.dll", "imm32.dll", "iphlpapi.dll", "kernel32.dll", "ksuser.dll", "mfplat.dll", "mfuuid.dll", "msimg32.dll", "msvcrt.dll", "ncrypt.dll", "netapi32.dll", "normaliz.dll", "ntdll.dll", "ole32.dll", "oleaut32.dll", "opengl32.dll", "powrprof.dll", "psapi.dll", "rpcrt4.dll", "secur32.dll", "setupapi.dll", "shell32.dll", "shlwapi.dll", "ucrtbase.dll", "user32.dll", "userenv.dll", "usp10.dll", "version.dll", "winmm.dll", "winspool.drv", "wintrust.dll", "ws2_32.dll", "wtsapi32.dll"}
# Windows Video for Windows / Audio Compression Manager. Verified Microsoft
# system components; never copy them from the cross toolchain or user machine.
SYSTEM_DLLS.update({"avicap32.dll", "avifil32.dll", "msacm32.dll", "d3d9.dll", "mf.dll", "mfreadwrite.dll", "uxtheme.dll", "cfgmgr32.dll", "shcore.dll"})


def classify_imports(names, lookup):
    dependencies, unresolved = [], []
    for name in names:
        lower = name.lower()
        if lower in SYSTEM_DLLS or lower.startswith(("api-ms-win-", "ext-ms-win-")):
            continue
        if lower in lookup:
            dependencies.append(lookup[lower])
        else:
            unresolved.append(name)
    return dependencies, unresolved


def pack_runtime(work):
    tree = work / "mpv"
    prefix = tree / "mingw_prefix"
    runtime = work / "runtime"
    runtime.mkdir()
    candidates = [*prefix.joinpath("bin").glob("*.dll"), *Path("/usr/lib/gcc/x86_64-w64-mingw32").glob("*-posix/*.dll"), *Path("/usr/x86_64-w64-mingw32/lib").glob("*.dll")]
    lookup = {p.name.lower(): p for p in candidates}
    roots = [tree / "mingw_build/libmpv-2.dll", prefix / "bin/ffmpeg.exe", prefix / "bin/ffprobe.exe"]
    queue = roots.copy()
    copied = {}
    unresolved = set()
    while queue:
        file = queue.pop()
        key = file.name.lower()
        if key in copied:
            continue
        shutil.copyfile(file, runtime / file.name)
        table = subprocess.check_output(["x86_64-w64-mingw32-objdump", "-p", str(file)], text=True)
        imports = re.findall(r"DLL Name:\s*(\S+)", table)
        copied[key] = {"name": file.name, "sha256": digest(file), "bytes": file.stat().st_size, "imports": imports}
        dependencies, missing = classify_imports(imports, lookup)
        queue.extend(dependencies)
        unresolved.update(missing)
    evidence = work / "evidence"
    data = {"schemaVersion": 1, "approved": False, "sourceComplianceApproved": False,
            "closureValid": not unresolved, "unresolvedImports": sorted(unresolved),
            "mpvCommit": MPV_COMMIT, "movieCommit": os.environ.get("GITHUB_SHA"), "files": list(copied.values()),
            "inputsSha256": digest(evidence / "inputs.json"), "toolchainManifestSha256": digest(work.parent / "toolchain-sha256.txt"),
            "buildRecipeSha256": digest(evidence / "movie-build-mingw64.sh"), "sourceCollectorSha256": digest(evidence / "source-capture.py"),
            "ffmpegConfigSha256": digest(evidence / "ffmpeg-config.txt"), "mpvOptionsSha256": digest(evidence / "mpv-buildoptions.json")}
    (work / "evidence/binary-source-map.json").write_text(json.dumps(data, indent=2) + "\n")
    for name in ["Copyright", "LICENSE.GPL", "LICENSE.LGPL"]:
        shutil.copyfile(tree / name, runtime / name)
    shutil.make_archive(str(work / "runtime-private-candidate"), "zip", runtime)
    if unresolved:
        # Preserve encrypted-only recovery material so a packaging error does
        # not discard a completed 30-minute compilation. This is NOT a valid
        # runtime candidate; CI still fails and records every missing import.
        raise ValueError("Unresolved native imports: " + ", ".join(sorted(unresolved)))


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    if command == "checkpoint":
        checkpoint(*args)
    elif command == "download":
        capture_download(*args)
    elif command == "build":
        bootstrap(*args)
    else:
        raise ValueError("Unknown source build command")
