import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import subprocess

spec = importlib.util.spec_from_file_location("source_companion", Path(__file__).parents[2] / "scripts/prepare-source-review-companion.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CompanionTests(unittest.TestCase):
    def test_public_source_scope_cannot_promote_stable_or_unapproved(self):
        approval = {"approved": True, "version": "1.2.3-beta.1", "scope": "public-prerelease-portable-only", "stableReleaseApproved": False}
        native = {"approved": True, "binaries": [{"sourceComplianceApproved": True}]}
        module.validate_public_test(approval, "1.2.3-beta.1", native)
        for change in [{"approved": False}, {"version": "1.2.3"}, {"stableReleaseApproved": True}]:
            with self.assertRaises(ValueError):
                module.validate_public_test({**approval, **change}, "1.2.3-beta.1", native)
        with self.assertRaises(ValueError):
            module.validate_public_test(approval, "1.2.3-beta.1", {**native, "approved": False})

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

    def test_application_archive_has_no_release_approval_hash_cycle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            (root / "build").mkdir()
            (root / "src").mkdir()
            (root / ".gitattributes").write_text(
                "build/release-approval.json export-ignore\n", encoding="utf8"
            )
            approval = root / "build/release-approval.json"
            approval.write_text('{"correspondingNativeSourcesSha256":"first"}\n', encoding="utf8")
            (root / "src" / "app.js").write_text("export const version = 1;\n", encoding="utf8")

            def git(*args):
                subprocess.run(["git", *args], cwd=root, check=True,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)

            git("init", "--quiet")
            git("config", "user.name", "Release Test")
            git("config", "user.email", "release-test@example.invalid")
            git("add", ".")
            git("commit", "-m", "first approval")
            first_commit = subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=root, text=True
            ).strip()
            first_zip = Path(directory) / "application-first.zip"
            module.archive_application_sources(root, first_commit, first_zip)
            with zipfile.ZipFile(first_zip) as archive:
                self.assertEqual(archive.comment, b"")
                self.assertNotIn("build/release-approval.json", archive.namelist())

            approval.write_text('{"correspondingNativeSourcesSha256":"second"}\n', encoding="utf8")
            git("add", ".")
            git("commit", "-m", "second approval")
            second_commit = subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=root, text=True
            ).strip()
            second_zip = Path(directory) / "application-second.zip"
            module.archive_application_sources(root, second_commit, second_zip)
            self.assertNotEqual(first_commit, second_commit)
            self.assertEqual(module.digest(first_zip), module.digest(second_zip))
    def test_utf8_json_reader_handles_non_ascii_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "qa.json"
            path.write_text('{"status":"PASS","note":"本地发行验证通过"}', encoding="utf-8")
            self.assertEqual(module.read_json(path)["note"], "本地发行验证通过")
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
