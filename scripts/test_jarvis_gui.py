#!/usr/bin/env python3
"""
Unit & lifecycle smoke tests for `jarvis_gui.py`.
Runs cleanly with standard library only (no pywebview display required).
"""

from __future__ import annotations

import http.server
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import jarvis_gui  # noqa: E402


class FakeJarvisHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/api/jarvis/health":
            payload = json.dumps({"reachable": False, "activeProvider": "offline"}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("X-Creator-Attribution", "J.A.R.V.I.S (c) 2026 cosmoknight")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        return


class JarvisGuiLauncherTests(unittest.TestCase):
    def test_parse_dotenv_handles_quotes_comments_and_exports(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env"
            env_file.write_text(
                "# comment\n"
                "PLAIN=hello\n"
                "QUOTED=\"world 123\"\n"
                "export SINGLE='abc=def'\n"
                "INVALID_LINE\n",
                encoding="utf-8",
            )
            parsed = jarvis_gui.parse_dotenv(env_file)
            self.assertEqual(parsed["PLAIN"], "hello")
            self.assertEqual(parsed["QUOTED"], "world 123")
            self.assertEqual(parsed["SINGLE"], "abc=def")
            self.assertNotIn("INVALID_LINE", parsed)

    def test_resolve_server_mode_auto_detects_dist_freshness(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "src").mkdir()
            src_file = root / "src" / "App.tsx"
            src_file.write_text("export const App = () => null;", encoding="utf-8")

            # No dist/ -> development
            self.assertEqual(jarvis_gui.resolve_server_mode("auto", root), "development")
            self.assertEqual(jarvis_gui.resolve_server_mode("prod", root), "production")
            self.assertEqual(jarvis_gui.resolve_server_mode("dev", root), "development")

            # dist/index.html newer than src -> production
            (root / "dist").mkdir()
            dist_index = root / "dist" / "index.html"
            dist_index.write_text("<html></html>", encoding="utf-8")
            now = time.time()
            os.utime(src_file, (now - 60, now - 60))
            os.utime(dist_index, (now, now))
            self.assertEqual(jarvis_gui.resolve_server_mode("auto", root), "production")

            # src edited after dist build -> development
            os.utime(src_file, (now + 60, now + 60))
            self.assertEqual(jarvis_gui.resolve_server_mode("auto", root), "development")

    def test_resolve_server_command_prefers_direct_node_tsx(self) -> None:
        cmd = jarvis_gui.resolve_server_command(REPO_ROOT)
        self.assertGreaterEqual(len(cmd), 3)
        self.assertIn("node", Path(cmd[0]).name.lower())
        self.assertTrue(cmd[1].endswith(os.path.join("tsx", "dist", "cli.mjs")))
        self.assertTrue(cmd[2].endswith("server.ts"))

    def test_probe_jarvis_health_recognizes_jarvis_endpoint(self) -> None:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeJarvisHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            ok, is_jarvis = jarvis_gui.probe_jarvis_health("127.0.0.1", port)
            self.assertTrue(ok)
            self.assertTrue(is_jarvis)
        finally:
            server.shutdown()
            server.server_close()

    def test_manager_fails_fast_when_child_crashes_immediately(self) -> None:
        cmd = [sys.executable, "-c", "import sys; print('boom'); sys.exit(42)"]
        mgr = jarvis_gui.ServerProcessManager(cmd=cmd, cwd=REPO_ROOT, env=os.environ.copy())
        mgr.start()
        try:
            with self.assertRaises(RuntimeError) as ctx:
                mgr.wait_for_ready("127.0.0.1", jarvis_gui.find_free_port(), timeout_sec=5.0)
            self.assertIn("42", str(ctx.exception))
        finally:
            mgr.stop()

    def test_manager_terminates_child_process_tree_cleanly(self) -> None:
        # Spawn a child that spawns a grandchild, and verify stopping the manager kills both
        script = (
            "import subprocess, sys, time\n"
            "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
            "print(child.pid, flush=True)\n"
            "time.sleep(60)\n"
        )
        mgr = jarvis_gui.ServerProcessManager(
            cmd=[sys.executable, "-c", script],
            cwd=REPO_ROOT,
            env=os.environ.copy(),
        )
        mgr.start()
        try:
            deadline = time.monotonic() + 5.0
            grandchild_pid = None
            while time.monotonic() < deadline:
                logs = mgr.recent_logs().strip()
                if logs.isdigit():
                    grandchild_pid = int(logs)
                    break
                time.sleep(0.05)

            self.assertIsNotNone(grandchild_pid, "Expected grandchild PID to be logged")
            mgr.stop()
            self.assertIsNotNone(mgr.process)
            self.assertIsNotNone(mgr.process.poll(), "Parent process should have exited")

            # Confirm grandchild is also dead
            time.sleep(0.2)
            alive = True
            try:
                os.kill(grandchild_pid, 0)  # type: ignore[arg-type]
            except OSError:
                alive = False
            self.assertFalse(alive, "Grandchild process should be terminated on cleanup")
        finally:
            mgr.stop()

    def test_real_server_ts_boots_and_shuts_down_cleanly(self) -> None:
        port = jarvis_gui.find_free_port("127.0.0.1")
        cmd = jarvis_gui.resolve_server_command(REPO_ROOT)
        env = jarvis_gui.build_child_env(REPO_ROOT, port=port, server_mode="development")
        mgr = jarvis_gui.ServerProcessManager(cmd=cmd, cwd=REPO_ROOT, env=env)
        mgr.start()
        try:
            mgr.wait_for_ready("127.0.0.1", port, timeout_sec=25.0)
            ok, is_jarvis = jarvis_gui.probe_jarvis_health("127.0.0.1", port)
            self.assertTrue(ok)
            self.assertTrue(is_jarvis)
        finally:
            mgr.stop()

        # Port must be released after shutdown
        time.sleep(0.3)
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.3)
            self.assertNotEqual(
                sock.connect_ex(("127.0.0.1", port)),
                0,
                f"Port {port} should be free after ServerProcessManager.stop()",
            )

    def test_desktop_api_save_file_writes_decoded_bytes_and_handles_cancel(self) -> None:
        import base64
        import types

        with tempfile.TemporaryDirectory() as tmp:
            out_file = Path(tmp) / "filled_report.docx"
            payload_bytes = b"PK\x03\x04test-docx-bytes"
            b64 = base64.b64encode(payload_bytes).decode("ascii")

            class FakeWindow:
                def __init__(self, dialog_return: object) -> None:
                    self.dialog_return = dialog_return
                    self.last_call: object = None

                def create_file_dialog(self, dialog_type: object, directory: str = "", save_filename: str = "", file_types: object = ()) -> object:
                    self.last_call = (dialog_type, directory, save_filename, file_types)
                    return self.dialog_return

            fake_webview = types.SimpleNamespace(SAVE_DIALOG=30)

            # 1. String return path (pywebview 5.x/6.x)
            api = jarvis_gui.DesktopApi()
            win = FakeWindow(str(out_file))
            api.attach(win, fake_webview)
            res = api.save_file("report_filled.docx", b64)
            self.assertTrue(res["ok"])
            self.assertEqual(res["path"], str(out_file))
            self.assertEqual(out_file.read_bytes(), payload_bytes)

            # 2. Tuple return path
            out_file2 = Path(tmp) / "deck.pptx"
            win2 = FakeWindow((str(out_file2),))
            api.attach(win2, fake_webview)
            res2 = api.save_file("deck.pptx", b64)
            self.assertTrue(res2["ok"])
            self.assertEqual(out_file2.read_bytes(), payload_bytes)

            # 3. Cancelled dialog
            win_cancel = FakeWindow(None)
            api.attach(win_cancel, fake_webview)
            res_cancel = api.save_file("deck.pptx", b64)
            self.assertFalse(res_cancel["ok"])
            self.assertTrue(res_cancel.get("cancelled"))

            # 4. Invalid base64 rejected cleanly
            res_bad = api.save_file("deck.pptx", "!!!not-valid-base64!!!")
            self.assertFalse(res_bad["ok"])
            self.assertIn("Invalid file payload", str(res_bad.get("error", "")))


if __name__ == "__main__":
    unittest.main()
