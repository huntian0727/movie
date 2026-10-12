"""Retain exact file notices from the pinned producer's actual libmpv objects.

Reads archives without extracting or executing upstream code. This is technical
evidence, not an approval writer. Other component notices remain in the existing
full-text collection and the corresponding-source archive.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import tarfile

MPV_COMMIT = "d94d09581474d6e91d7a0e544b07de4eb8b07a9f"
GPL_ONLY = {"audio/out/ao_jack.c", "audio/out/ao_oss.c", "stream/stream_cdda.c",
            "stream/stream_dvdnav.c", "video/out/vo_caca.c", "video/out/vo_direct3d.c",
            "video/out/vo_vaapi.c", "video/out/vo_vdpau.c", "video/out/vo_x11.c", "video/out/vo_xv.c"}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def file_digest(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def source_members(archive):
    files = {}
    with tarfile.open(archive) as tar:
        for member in tar:
            p = PurePosixPath(member.name)
            if p.is_absolute() or ".." in p.parts or "\\" in member.name:
                raise ValueError("Unsafe source member")
            if member.isfile():
                relative = member.name.partition("/")[2]
                if relative in files:
                    raise ValueError("Duplicate source member")
                files[relative] = tar.extractfile(member).read()
    return files

def compiled_sources(log, files):
    objects = re.findall(r"Compiling C object libmpv-2\.dll\.p/(\S+)\.obj", log)
    if not objects or len(objects) != len(set(objects)) or "Linking target libmpv-2.dll" not in log:
        raise ValueError("Incomplete or duplicate actual libmpv compilation evidence")
    mapping = {}
    for name in files:
        if name.endswith(".c"):
            key = name.replace("/", "_")
            if key in mapping:
                raise ValueError("Ambiguous object/source mapping")
            mapping[key] = name
    result = []
    for obj in objects:
        name = mapping.get(obj)
        if not name:
            raise ValueError("Compiled source missing from retained archive: " + obj)
        if name in GPL_ONLY or name.startswith(("stream/dvb", "stream/stream_dvb", "video/out/x11_common", "video/vdpau")):
            raise ValueError("Upstream GPL-only source compiled: " + name)
        result.append(name)
    return sorted(result)

def leading_notice(body):
    # Preserve all leading comments verbatim, including a BSD notice in // form.
    match = re.match(rb"(?:\s|/\*.*?\*/|//[^\n]*(?:\n|$)|;[^\n]*(?:\n|$))*", body, re.S)
    prefix = match.group(0)
    if re.search(rb"copyright|permission|redistribution|SPDX-License|[Ll]icen[cs]e", prefix, re.I):
        return prefix.rstrip(b"\r\n")
    return None

def local_includes(files, initial):
    visited, pending = set(), list(initial)
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        for include in re.findall(rb'^\s*#\s*include\s+"([^"\n]+)"', files[name], re.M):
            relative = include.decode("utf8")
            for candidate in (posixpath.normpath(posixpath.join(posixpath.dirname(name), relative)), relative):
                if candidate in files:
                    pending.append(candidate)
                    break
    return sorted(visited)

def cmake_library_sources(log, files, targets):
    result = set()
    for obj in re.findall(r"Building CXX object (\S+)\.obj", log):
        match = re.match(r"(.*?)(?:/)?CMakeFiles/([^/]+)\.dir/(.+)", obj)
        if not match or match[2] not in targets:
            continue
        source_suffix = "/".join(".." if part == "__" else part for part in match[3].split("/"))
        candidate = posixpath.normpath(posixpath.join(match[1], source_suffix))
        if candidate not in files:
            raise ValueError("Vendor compiled source missing: " + obj)
        result.add(candidate)
    if not result:
        raise ValueError("Vendor library compilation evidence absent")
    return sorted(result)

def audit(evidence, log_file, notices_file, report_file):
    evidence, log_file = Path(evidence), Path(log_file)
    manifest = json.loads((evidence / "inputs.json").read_text(encoding="utf8"))
    rows = manifest["inputs"]
    if manifest.get("approved") is not False or len(rows) != 25 or len({r["name"] for r in rows}) != 25:
        raise ValueError("Expected exact unapproved 25-input capture")
    for row in rows:
        if Path(row["archive"]).name != row["archive"] or "\\" in row["archive"]:
            raise ValueError("Unsafe source archive name")
        p = evidence / row["archive"]
        if p.is_symlink() or not p.is_file() or p.stat().st_size != row["bytes"] or file_digest(p) != row["sha256"]:
            raise ValueError("Retained source differs: " + row["name"])
    mpv = next(r for r in rows if r["name"] == "mpv")
    if mpv.get("commit") != MPV_COMMIT:
        raise ValueError("Unexpected mpv revision")
    files = source_members(evidence / mpv["archive"])
    log = log_file.read_text(encoding="utf-8-sig")
    compiled = compiled_sources(log, files)
    if len(compiled) != 244:
        raise ValueError("Unexpected producer compilation count")
    reachable = local_includes(files, compiled)
    records, texts = [], {}
    for name in reachable:
        notice = leading_notice(files[name])
        if notice:
            h = digest(notice)
            texts[h] = notice
            records.append({"component": "mpv", "path": name, "sourceSha256": digest(files[name]), "noticeSha256": h,
                            "scope": "compiled-C-source" if name in compiled else "literal-include-closure"})
    if not any(r["path"] == "audio/filter/af_scaletempo2_internals.h" for r in records):
        raise ValueError("Chromium BSD notice missing")
    for name in ["misc/thread_pool.c", "misc/thread_tools.c", "player/client.c", "ta/ta.c", "ta/ta_talloc.c", "ta/ta_utils.c"]:
        if not any(r["path"] == name for r in records):
            raise ValueError("Compiled ISC notice missing: " + name)
    shaderc = next(r for r in rows if r["name"] == "shaderc")
    vendor_files = source_members(evidence / shaderc["archive"])
    targets = {"SPIRV-Tools-static", "SPIRV-Tools-shared", "SPIRV-Tools-opt", "SPIRV-Tools-reduce", "SPIRV-Tools-link",
               "SPIRV-Tools-lint", "SPIRV-Tools-diff", "glslang", "glslang-default-resource-limits", "SPIRV",
               "GenericCodeGen", "MachineIndependent", "OSDependent", "shaderc_util", "shaderc", "shaderc_shared"}
    vendor_compiled = cmake_library_sources(log, vendor_files, targets)
    vendor_reachable = local_includes(vendor_files, vendor_compiled)
    for name in vendor_reachable:
        notice = leading_notice(vendor_files[name])
        if notice:
            h = digest(notice)
            texts[h] = notice
            records.append({"component": "shaderc-library-build", "path": name, "sourceSha256": digest(vendor_files[name]),
                            "noticeSha256": h, "scope": "compiled-build-library-source" if name in vendor_compiled else "literal-include-closure"})
    # Preserve per-file credits for other producer inputs too. This deliberate
    # superset does not assign unlinked/GPL test source terms to the runtime.
    recorded = {(r["component"], r["path"]) for r in records}
    archive_notice_counts = {}
    for row in rows:
        if row["name"] == "mpv" or row["kind"] != "pre-build-source-tree" and "AMF-headers" not in row["archive"]:
            continue
        component = "shaderc-library-build" if row["name"] == "shaderc" else row["name"]
        archive_files = vendor_files if row["name"] == "shaderc" else source_members(evidence / row["archive"])
        count = 0
        for name, body in sorted(archive_files.items()):
            if PurePosixPath(name).suffix.lower() not in {".c", ".h", ".cpp", ".hpp", ".cc", ".asm", ".s", ".inc"} or (component, name) in recorded:
                continue
            notice = leading_notice(body)
            if notice:
                h = digest(notice)
                texts[h] = notice
                records.append({"component": component, "path": name, "sourceSha256": digest(body), "noticeSha256": h,
                                "scope": "retained-source-notice-preservation-not-a-runtime-assignment"})
                recorded.add((component, name))
                count += 1
        archive_notice_counts[component] = count
    chunks = [b"Exact native source-file notice supplement.\nOriginal upstream text follows.\nThis conservative collection also preserves unlinked source/test notices; those terms are not automatically the runtime license. Library-build targets and literal includes are not a full link/preprocessor map.\n\n"]
    for h in sorted(texts):
        names = [r["component"] + ":" + r["path"] for r in records if r["noticeSha256"] == h]
        chunks.append(("SHA256: " + h + "\nSOURCE PATHS: " + ", ".join(names) + "\n").encode())
        chunks.append(texts[h] + b"\n\n")
    notices = b"".join(chunks)
    report = {"schemaVersion": 1, "approved": False, "sourceComplianceApproved": False,
              "producerRun": 38134981406, "originalCiConclusion": "FAIL", "mpvCommit": MPV_COMMIT,
              "sourceManifestSha256": file_digest(evidence / "inputs.json"), "sourceArchivesVerified": len(rows),
              "producerLogSha256": file_digest(log_file), "recipeSha256": file_digest(evidence / "movie-build-mingw64.sh"),
              "compiledSources": [{"path": name, "sha256": digest(files[name])} for name in compiled],
              "vendorLibraryBuildSources": [{"path": name, "sha256": digest(vendor_files[name])} for name in vendor_compiled],
              "vendorLiteralIncludeClosureCount": len(vendor_reachable),
              "additionalArchiveNoticeCounts": archive_notice_counts,
              "gplOnlyCompiledSources": [], "literalIncludeClosureCount": len(reachable), "noticeRecords": records,
              "noticeDistinctTexts": len(texts), "noticeFileSha256": digest(notices),
              "limits": ["Source/header notices and observed object names do not by themselves certify all transitive licensing.",
                         "The original failing producer and closure-false map are preserved.",
                         "No cold rebuild or bit-identical rebuild claim; no approval file is changed."]}
    Path(notices_file).write_bytes(notices)
    Path(report_file).write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"inputs": len(rows), "compiledSources": len(compiled), "literalIncludes": len(reachable),
                      "noticeRecords": len(records), "distinctNoticeTexts": len(texts), "approved": False}))
    return report

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ["evidence", "producer-log", "notices", "report"]:
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    audit(args.evidence, args.producer_log, args.notices, args.report)
