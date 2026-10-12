import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("source_companion", Path(__file__).parents[2] / "scripts/prepare-source-review-companion.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CompanionTests(unittest.TestCase):
    def source(self, directory, names):
        source = Path(directory) / "sources.zip"
        with zipfile.ZipFile(source, "w") as archive:
            for name in names:
                archive.writestr(name, "fixture")
        return source

    def test_matching_source_zip_crc_and_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source(directory, ["evidence/input.tar.gz", "toolchain/compiler.txt"])
            with patch.object(module, "SOURCE_BYTES", source.stat().st_size), patch.object(module, "SOURCE_SHA256", module.digest(source)):
                module.verify_source_zip(source)

    def test_matching_pin_does_not_allow_program_or_traversal(self):
        for name in ["../escape.txt", "/absolute.txt", "host.exe", "player.dll", "compiler.nupkg", "folder\\file.txt"]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                source = self.source(directory, [name])
                if "\\" in name:
                    # Windows ZipInfo normalizes separators on write; retain an
                    # actual foreign ZIP member spelling in both name records.
                    source.write_bytes(source.read_bytes().replace(name.replace("\\", "/").encode(), name.encode()))
                with patch.object(module, "SOURCE_BYTES", source.stat().st_size), patch.object(module, "SOURCE_SHA256", module.digest(source)), self.assertRaises(ValueError):
                    module.verify_source_zip(source)

    def test_changed_archive_rejected_before_staging(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source(directory, ["source.tar.gz"])
            target = Path(directory) / "new-output"
            with self.assertRaises(ValueError):
                module.prepare(source, target)
            self.assertFalse(target.exists())

    def test_existing_output_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "existing"
            target.mkdir()
            keep = target / "keep.txt"
            keep.write_text("existing content")
            with self.assertRaises(ValueError):
                module.prepare(Path(directory) / "absent.zip", target)
            self.assertEqual(keep.read_text(), "existing content")

    def test_workspace_output_rejected(self):
        target = module.ROOT / "release" / "fixture-review-should-not-be-created"
        with self.assertRaises(ValueError):
            module.prepare("absent.zip", target)
        self.assertFalse(target.exists())

if __name__ == "__main__":
    unittest.main()
