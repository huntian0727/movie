import importlib.util
import json
import os
import subprocess
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

FILE = Path(__file__).resolve().parents[2] / "scripts/native-source-build.py"
spec = importlib.util.spec_from_file_location("native_source_build", FILE)
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class SourceCaptureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "evidence").mkdir()
        (self.root / "mpv").mkdir()
        self.env = patch.dict(os.environ, {"SOURCE_EVIDENCE_DIR": str(self.root / "evidence"), "SOURCE_BUILD_ROOT": str(self.root / "mpv")})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_source_is_saved_before_build_without_git_or_generated_objects(self):
        tree = self.root / "mpv/dependency"
        tree.mkdir()
        (tree / "LICENSE").write_text("test license")
        (tree / "source.c").write_text("original source")
        (tree / "builddir").mkdir()
        (tree / "builddir/object.o").write_bytes(b"do not include compiled object")
        build.checkpoint(tree)
        (tree / "source.c").write_text("changed after compilation")
        build.checkpoint(tree)
        archive = self.root / "evidence/dependency.tar.gz"
        with tarfile.open(archive) as tar:
            self.assertEqual(tar.extractfile("dependency/source.c").read(), b"original source")
            self.assertNotIn("dependency/builddir/object.o", tar.getnames())
        data = json.loads((self.root / "evidence/inputs.json").read_text())
        self.assertFalse(data["approved"])
        self.assertEqual(len(data["inputs"]), 1)
        self.assertEqual(data["inputs"][0]["sha256"], build.digest(archive))

    def test_checkpoint_rejects_root_or_outside_tree(self):
        for tree in [self.root, self.root / "mpv"]:
            with self.assertRaises(ValueError):
                build.checkpoint(tree)

    def test_original_download_bytes_are_retained_and_bound_to_url(self):
        file = self.root / "source.tar.gz"
        file.write_bytes(b"original source archive")
        build.capture_download("https://example.org/source.tar.gz", file)
        build.capture_download("https://example.org/source.tar.gz", file)
        data = json.loads((self.root / "evidence/inputs.json").read_text())
        self.assertEqual(len(data["inputs"]), 1)
        row = data["inputs"][0]
        self.assertEqual((self.root / "evidence" / row["archive"]).read_bytes(), file.read_bytes())
        self.assertEqual(row["url"], "https://example.org/source.tar.gz")
        with self.assertRaises(ValueError):
            build.capture_download("https://credential@example.org/source.tar.gz", file)

    def test_changed_recipe_cannot_be_transformed(self):
        with self.assertRaisesRegex(ValueError, "bytes differ"):
            build.patch_recipe(b"unreviewed upstream recipe", Path("/helper"))
        with self.assertRaises(ValueError):
            build.replace_once("item item", "item", "patched")

    def test_changed_saved_source_archive_is_rejected(self):
        tree = self.root / "mpv/dependency"
        tree.mkdir()
        (tree / "source.c").write_text("original")
        build.checkpoint(tree)
        (self.root / "evidence/dependency.tar.gz").write_bytes(b"replaced archive")
        with self.assertRaisesRegex(ValueError, "differs"):
            build.checkpoint(tree)

    def test_nested_git_revisions_and_source_are_retained(self):
        tree = self.root / "mpv/dependency"
        nested = tree / "third_party/nested"
        nested.mkdir(parents=True)
        for directory in [tree, nested]:
            subprocess.run(["git", "init", "-q", str(directory)], check=True)
            (directory / "source.txt").write_text("fixture source")
            subprocess.run(["git", "-C", str(directory), "add", "source.txt"], check=True)
            subprocess.run(["git", "-C", str(directory), "-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "commit", "-qm", "source fixture"], check=True)
            subprocess.run(["git", "-C", str(directory), "remote", "add", "origin", "https://example.org/source.git"], check=True)
        build.checkpoint(tree)
        data = json.loads((self.root / "evidence/inputs.json").read_text())
        repositories = data["inputs"][0]["git"]
        self.assertEqual({r["path"].replace("\\", "/") for r in repositories}, {".", "third_party/nested"})
        for repository in repositories:
            self.assertRegex(repository["commit"], "^[0-9a-f]{40}$")
        with tarfile.open(self.root / "evidence/dependency.tar.gz") as tar:
            self.assertIn("dependency/third_party/nested/source.txt", tar.getnames())
            self.assertFalse(any(".git" in Path(p).parts for p in tar.getnames()))


if __name__ == "__main__":
    unittest.main()
