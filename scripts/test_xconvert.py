#!/usr/bin/env python3
"""Unit tests for xconvert_engine.py and DesktopApi Xconvert methods in jarvis_gui.py."""

from __future__ import annotations

import json
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import jarvis_gui  # noqa: E402
import xconvert_engine  # noqa: E402


class FakeWindow:
    def __init__(self, selection):
        self.selection = selection
        self.calls = []

    def create_file_dialog(self, dialog_type, directory="", allow_multiple=False, file_types=()):
        self.calls.append((dialog_type, directory, allow_multiple, file_types))
        return self.selection


class XconvertEngineTests(unittest.TestCase):
    def test_get_capabilities_shape(self) -> None:
        caps = xconvert_engine.get_capabilities()
        self.assertIn("engines", caps)
        self.assertIn("install_hint", caps)
        expected_keys = {
            "PIL",
            "img2pdf",
            "fitz",
            "docx",
            "pdf2docx",
            "pandas",
            "openpyxl",
            "yaml",
            "imageio_ffmpeg",
            "py7zr",
            "markdown",
        }
        self.assertTrue(expected_keys.issubset(set(caps["engines"].keys())))
        for key in expected_keys:
            self.assertIsInstance(caps["engines"][key], bool)
        self.assertIsInstance(caps["install_hint"], str)

    def test_inspect_file_categories_and_tar_gz(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            img = root / "photo.PNG"
            img.write_bytes(b"fake")
            info_img = xconvert_engine.inspect_file(str(img))
            self.assertEqual(info_img["ext"], "png")
            self.assertEqual(info_img["category"], "image")
            self.assertNotIn("png", info_img["compatible_targets"])
            self.assertIn("jpg", info_img["compatible_targets"])
            self.assertIn("pdf", info_img["compatible_targets"])

            arc = root / "backup.tar.gz"
            arc.write_bytes(b"fake")
            info_arc = xconvert_engine.inspect_file(str(arc))
            self.assertEqual(info_arc["ext"], "tar.gz")
            self.assertEqual(info_arc["category"], "archive")
            self.assertIn("zip", info_arc["compatible_targets"])
            self.assertNotIn("tar.gz", info_arc["compatible_targets"])

            unknown = root / "blob.xyz"
            unknown.write_bytes(b"fake")
            info_unk = xconvert_engine.inspect_file(str(unknown))
            self.assertEqual(info_unk["category"], "unsupported")
            self.assertEqual(info_unk["compatible_targets"], [])

    def test_document_data_and_archive_disk_to_disk_conversions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out_dir = root / "out"

            # 1. Documents: txt -> html -> md
            txt_file = root / "notes.txt"
            txt_file.write_text("Hello JARVIS\nSecond line", encoding="utf-8")

            # 2. Data: csv -> json and json -> xml
            csv_file = root / "metrics.csv"
            csv_file.write_text("name,score\nalpha,98\nbeta,87\n", encoding="utf-8")

            json_file = root / "items.json"
            json_file.write_text(json.dumps([{"id": "1", "label": "core"}]), encoding="utf-8")

            # 3. Archive: zip -> tar.gz
            zip_file = root / "bundle.zip"
            with zipfile.ZipFile(zip_file, "w") as zf:
                zf.writestr("hello.txt", "archive payload")

            results = xconvert_engine.convert_batch(
                [
                    {"input_path": str(txt_file), "target_format": "html", "output_dir": str(out_dir)},
                    {"input_path": str(csv_file), "target_format": "json", "output_dir": str(out_dir)},
                    {"input_path": str(json_file), "target_format": "xml", "output_dir": str(out_dir)},
                    {"input_path": str(zip_file), "target_format": "tar.gz", "output_dir": str(out_dir)},
                ]
            )

            self.assertEqual(len(results), 4)
            for res in results:
                self.assertTrue(res["ok"], f"Expected ok=True, got: {res}")
                self.assertIsNone(res["error"])
                self.assertTrue(Path(res["output_path"]).is_file())
                self.assertIsInstance(res["duration_ms"], int)

            # Verify converted content integrity
            html_out = Path(results[0]["output_path"]).read_text(encoding="utf-8")
            self.assertIn("Hello JARVIS", html_out)

            json_out = json.loads(Path(results[1]["output_path"]).read_text(encoding="utf-8"))
            self.assertEqual(json_out[0]["name"], "alpha")

            xml_out = Path(results[2]["output_path"]).read_text(encoding="utf-8")
            self.assertIn("<label>core</label>", xml_out)

            with tarfile.open(results[3]["output_path"], "r:gz") as tf:
                names = tf.getnames()
                self.assertIn("hello.txt", names)

    def test_collision_appends_converted_suffix(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = root / "doc.txt"
            src.write_text("content", encoding="utf-8")
            existing = root / "doc.md"
            existing.write_text("pre-existing", encoding="utf-8")

            res = xconvert_engine.convert_batch(
                [{"input_path": str(src), "target_format": "md", "output_dir": None}]
            )[0]

            self.assertTrue(res["ok"])
            self.assertEqual(Path(res["output_path"]).name, "doc_converted.md")
            self.assertEqual(existing.read_text(encoding="utf-8"), "pre-existing")

    def test_zip_slip_traversal_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            evil_zip = root / "evil.zip"
            with zipfile.ZipFile(evil_zip, "w") as zf:
                zf.writestr("../escaped.txt", "pwned")

            res = xconvert_engine.convert_batch(
                [{"input_path": str(evil_zip), "target_format": "tar", "output_dir": str(root)}]
            )[0]

            self.assertFalse(res["ok"])
            self.assertIn("path traversal", (res["error"] or "").lower())
            self.assertFalse((root.parent / "escaped.txt").exists())


class DesktopApiXconvertTests(unittest.TestCase):
    def test_pick_files_pywebview_v5_and_v6_constants(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sample = Path(tmp) / "report.csv"
            sample.write_text("a,b\n1,2\n", encoding="utf-8")

            # pywebview 4.x/5.x OPEN_DIALOG constant
            api_v5 = jarvis_gui.DesktopApi()
            win_v5 = FakeWindow((str(sample),))
            api_v5.attach(win_v5, SimpleNamespace(OPEN_DIALOG=10))
            picked = api_v5.xconvert_pick_files()
            self.assertEqual(len(picked), 1)
            self.assertEqual(picked[0]["name"], "report.csv")
            self.assertEqual(picked[0]["category"], "data")
            self.assertEqual(win_v5.calls[0][0], 10)
            self.assertTrue(win_v5.calls[0][2])  # allow_multiple=True

            # pywebview 6.x FileDialog.OPEN enum
            api_v6 = jarvis_gui.DesktopApi()
            win_v6 = FakeWindow([str(sample)])
            api_v6.attach(win_v6, SimpleNamespace(FileDialog=SimpleNamespace(OPEN="ENUM_OPEN")))
            picked_v6 = api_v6.xconvert_pick_files()
            self.assertEqual(len(picked_v6), 1)
            self.assertEqual(win_v6.calls[0][0], "ENUM_OPEN")

    def test_pick_output_dir(self) -> None:
        api = jarvis_gui.DesktopApi()
        win = FakeWindow(["/tmp/output_dir"])
        api.attach(win, SimpleNamespace(FileDialog=SimpleNamespace(FOLDER="ENUM_FOLDER")))
        folder = api.xconvert_pick_output_dir()
        self.assertEqual(folder, "/tmp/output_dir")
        self.assertEqual(win.calls[0][0], "ENUM_FOLDER")

    def test_capabilities_run_batch_and_open_in_explorer(self) -> None:
        api = jarvis_gui.DesktopApi()
        caps = api.xconvert_capabilities()
        self.assertIn("engines", caps)

        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "hello.txt"
            src.write_text("hi", encoding="utf-8")
            results = api.xconvert_run_batch(
                [{"input_path": str(src), "target_format": "md", "output_dir": tmp}]
            )
            self.assertEqual(len(results), 1)
            self.assertTrue(results[0]["ok"])

            # Missing path rejected
            missing = api.xconvert_open_in_explorer(str(Path(tmp) / "does_not_exist.md"))
            self.assertFalse(missing["ok"])

            # Valid path invokes file manager via Popen without shell=True
            with patch("jarvis_gui.subprocess.Popen") as mock_popen:
                opened = api.xconvert_open_in_explorer(results[0]["output_path"])
                self.assertTrue(opened["ok"])
                mock_popen.assert_called_once()
                _, kwargs = mock_popen.call_args
                self.assertFalse(kwargs.get("shell", False))


if __name__ == "__main__":
    unittest.main()
