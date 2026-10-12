import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("source_licenses", Path(__file__).parents[2] / "scripts/audit-native-source-licenses.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def log(*objects):
    return "\n".join("Compiling C object libmpv-2.dll.p/" + obj + ".obj" for obj in objects) + "\nLinking target libmpv-2.dll"

class SourceLicenseTests(unittest.TestCase):
    def test_actual_object_resolves_exact_retained_source(self):
        self.assertEqual(module.compiled_sources(log("audio_filter.c"), {"audio/filter.c": b"source"}), ["audio/filter.c"])

    def test_missing_source_and_duplicate_objects_rejected(self):
        for evidence in [log("missing.c"), log("file.c", "file.c"), "Compiling C object libmpv-2.dll.p/file.c.obj"]:
            with self.assertRaises(ValueError):
                module.compiled_sources(evidence, {"file.c": b"source"})

    def test_gpl_only_sources_rejected(self):
        for name in ["audio/out/ao_jack.c", "video/out/vo_direct3d.c", "video/vdpau_mixer.c", "stream/stream_dvb.c"]:
            with self.assertRaises(ValueError):
                module.compiled_sources(log(name.replace("/", "_")), {name: b"source"})

    def test_ambiguous_source_mapping_rejected(self):
        with self.assertRaises(ValueError):
            module.compiled_sources(log("a_b.c"), {"a/b.c": b"one", "a_b.c": b"two"})

    def test_bsd_line_comment_notice_preserves_entire_disclaimer(self):
        body = b"// Copyright Chromium\r\n// Redistribution permitted.\r\n// DISCLAIMER\r\n\r\n#include <x>\n"
        self.assertEqual(module.leading_notice(body), body.split(b"#include")[0].rstrip(b"\r\n"))

    def test_block_comment_notice_preserves_grant(self):
        body = b"/* Copyright authors\n * Permission to use.\n * DISCLAIMER\n */\n\nint main(void);"
        self.assertEqual(module.leading_notice(body), body.split(b"int main")[0].rstrip(b"\r\n"))
        self.assertIsNone(module.leading_notice(b"#include <x>\n// Copyright in unrelated code below\n"))

    def test_include_closure_cycles_and_local_directory(self):
        files = {"src/a.c": b'#include "a.h"\n#include "root.h"', "src/a.h": b'#include "a.h"', "root.h": b"header"}
        self.assertEqual(module.local_includes(files, ["src/a.c"]), sorted(files))

    def test_archive_traversal_rejected_without_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "source.tar.gz"
            with tarfile.open(archive, "w:gz") as tar:
                member = tarfile.TarInfo("root/../escape.c")
                member.size = 1
                tar.addfile(member, io.BytesIO(b"x"))
            with self.assertRaises(ValueError):
                module.source_members(archive)

    def test_assembler_notice_preserves_grant(self):
        body = b"; Copyright authors\n; Redistribution permitted\n; DISCLAIMER\n%include config.asm"
        self.assertEqual(module.leading_notice(body), body.split(b"%include")[0].rstrip(b"\r\n"))

    def test_cmake_parent_encoding_and_missing_vendor_source(self):
        evidence = "Building CXX object third_party/lib/SPIRV/CMakeFiles/SPIRV.dir/__/src/a.cpp.obj"
        self.assertEqual(module.cmake_library_sources(evidence, {"third_party/lib/src/a.cpp": b"source"}, {"SPIRV"}), ["third_party/lib/src/a.cpp"])
        with self.assertRaises(ValueError):
            module.cmake_library_sources(evidence, {}, {"SPIRV"})

if __name__ == "__main__":
    unittest.main()
