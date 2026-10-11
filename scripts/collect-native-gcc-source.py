"""Collect the base GCC sources used by Ubuntu's MinGW wrapper package.

gcc-mingw-w64 sources alone contain the wrapper, not GCC/libstdc++ themselves.
The binary package version encodes the exact base GCC source package version.
"""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request


def gcc_source_identity(binary_version):
    match = re.fullmatch(r"(\d+)\.\d+\.\d+-[A-Za-z0-9.~]+\+(\d+(?:\.\d+)*)", binary_version)
    if not match:
        raise ValueError("Unexpected Ubuntu MinGW compiler version")
    return "gcc-" + match[1], binary_version.rsplit("+", 1)[0]


def dsc_files(body):
    section = body.split("Checksums-Sha256:\n", 1)
    if len(section) != 2:
        raise ValueError("Source descriptor has no SHA-256 section")
    entries = []
    for line in section[1].splitlines():
        if not line.startswith(" "):
            break
        match = re.fullmatch(r" ([0-9a-f]{64}) (\d+) ([A-Za-z0-9_.+~-]+)", line)
        if not match or match[3] in {".", ".."}:
            raise ValueError("Unsafe source descriptor entry")
        entries.append({"sha256": match[1], "bytes": int(match[2]), "name": match[3]})
    if not entries or len({row["name"] for row in entries}) != len(entries):
        raise ValueError("Source descriptor entries absent or duplicated")
    return entries


def collect(directory, binary_version):
    package, version = gcc_source_identity(binary_version)
    target = Path(directory).resolve()
    target.mkdir(parents=True, exist_ok=True)
    query = urllib.parse.urlencode({"ws.op": "getPublishedSources", "source_name": package, "version": version, "exact_match": "true"})
    api = "https://api.launchpad.net/1.0/ubuntu/+archive/primary?" + query
    with urllib.request.urlopen(api, timeout=45) as response:
        publications = json.load(response)["entries"]
    publication = next((row for row in publications if row["source_package_name"] == package and row["source_package_version"] == version and row["status"] != "Deleted"), None)
    if not publication:
        raise ValueError("Exact GCC source publication not found")
    with urllib.request.urlopen(publication["self_link"] + "?ws.op=sourceFileUrls", timeout=45) as response:
        urls = json.load(response)
    base = "/ubuntu/+archive/primary/+sourcefiles/" + package + "/" + version + "/"
    files = {}
    for url in urls:
        parsed = urllib.parse.urlparse(url)
        name = parsed.path.removeprefix(base)
        if parsed.scheme != "https" or parsed.netloc != "launchpad.net" or not parsed.path.startswith(base) or "/" in name or not re.fullmatch(r"[A-Za-z0-9_.+~-]+", name):
            raise ValueError("Unexpected GCC source file URL")
        files[name] = url
    descriptor = next(name for name in files if name.endswith(".dsc"))
    with urllib.request.urlopen(files[descriptor], timeout=120) as response:
        raw = response.read(200_001)
    if len(raw) > 200_000:
        raise ValueError("Oversized source descriptor")
    entries = dsc_files(raw.decode())
    (target / descriptor).write_bytes(raw)
    for row in entries:
        if row["name"] not in files:
            raise ValueError("Source archive is missing from exact publication")
        file = target / row["name"]
        if not file.exists():
            temporary = file.with_suffix(file.suffix + ".partial")
            with urllib.request.urlopen(files[row["name"]], timeout=120) as response, temporary.open("wb") as out:
                shutil.copyfileobj(response, out)
            temporary.rename(file)
        if file.stat().st_size != row["bytes"] or hashlib.file_digest(file.open("rb"), "sha256").hexdigest() != row["sha256"]:
            raise ValueError("GCC source archive identity mismatch: " + row["name"])
    result = {"schemaVersion": 1, "approved": False, "binaryPackageVersion": binary_version,
              "sourcePackage": package, "sourceVersion": version, "publication": publication["self_link"],
              "descriptorSha256": hashlib.sha256(raw).hexdigest(), "files": entries}
    (target / "gcc-base-source.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"sourcePackage": package, "sourceVersion": version, "filesVerified": len(entries), "approved": False}))


if __name__ == "__main__":
    directory = sys.argv[1]
    version = sys.argv[2] if len(sys.argv) > 2 else subprocess.check_output(["dpkg-query", "-W", "-f=${Version}", "gcc-mingw-w64-x86-64-posix-runtime"], text=True).strip()
    collect(directory, version)
