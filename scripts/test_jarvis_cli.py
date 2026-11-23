#!/usr/bin/env python3
"""
SPDX-License-Identifier: MIT
Copyright (c) 2026 cosmoknight — Offline Unit Tests for jarvis.py & ollama_pptx_generator.py
"""

import json
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import jarvis  # noqa: E402
from scripts import ollama_pptx_generator as pptgen  # noqa: E402


class TestJarvisCliHelpers(unittest.TestCase):
    def test_auto_model_routing_and_stickiness(self) -> None:
        m1, sticky1 = jarvis.choose_model("Hello Jarvis, how are you?", "auto", False)
        self.assertEqual(m1, jarvis.DEFAULT_GENERAL_MODEL)
        self.assertFalse(sticky1)

        m2, sticky2 = jarvis.choose_model(
            "Find the SyntaxError in this python function", "auto", sticky1
        )
        self.assertEqual(m2, jarvis.DEFAULT_CODING_MODEL)
        self.assertTrue(sticky2)

        # Follow-up stays sticky on coding model
        m3, sticky3 = jarvis.choose_model("Why did that happen?", "auto", sticky2)
        self.assertEqual(m3, jarvis.DEFAULT_CODING_MODEL)
        self.assertTrue(sticky3)

        # Explicit model override ignores auto routing
        m4, _ = jarvis.choose_model("Find the python bug", "qwen2.5:3b", False)
        self.assertEqual(m4, "qwen2.5:3b")

    def test_resolve_model_tag(self) -> None:
        installed = ["vai-doc:latest", "qwen2.5:3b", "qwen2.5-coder:7b"]
        self.assertEqual(jarvis.resolve_model_tag("vai-doc", installed), "vai-doc:latest")
        self.assertEqual(jarvis.resolve_model_tag("qwen2.5-coder:7b", installed), "qwen2.5-coder:7b")
        self.assertEqual(jarvis.resolve_model_tag("missing-model:1b", installed), "vai-doc:latest")

    def test_parse_ndjson_line(self) -> None:
        tok, done, err = jarvis.parse_ndjson_line(
            json.dumps({"message": {"role": "assistant", "content": "Fix line 2"}, "done": False})
        )
        self.assertEqual((tok, done, err), ("Fix line 2", False, None))

        tok2, done2, err2 = jarvis.parse_ndjson_line(json.dumps({"done": True}))
        self.assertEqual((tok2, done2, err2), ("", True, None))

        _, done3, err3 = jarvis.parse_ndjson_line(json.dumps({"error": "model not found"}))
        self.assertTrue(done3)
        self.assertEqual(err3, "model not found")

    def test_detect_ppt_request(self) -> None:
        self.assertEqual(
            jarvis.detect_ppt_request("/ppt Create a 6-slide deck on B-Trees"),
            "Create a 6-slide deck on B-Trees",
        )
        self.assertEqual(
            jarvis.detect_ppt_request("Create a 5-slide presentation comparing TCP and UDP"),
            "Create a 5-slide presentation comparing TCP and UDP",
        )
        self.assertIsNone(jarvis.detect_ppt_request("Find the error in my Python loop"))

    def test_slide_override_and_retry_validation(self) -> None:
        self.assertEqual(
            pptgen.parse_slide_count_override("Create a 6-slide deck on LSM-Trees", 8),
            (6, True),
        )
        self.assertEqual(
            pptgen.parse_slide_count_override("Compare Python 3 and HTTP 429 retries", 8),
            (8, False),
        )

        # Simulate first response failing count/notes, second response passing cleanly
        calls = []

        def fake_ollama(system_prompt: str, user_msg: str) -> str:
            calls.append(user_msg)
            if len(calls) == 1:
                return json.dumps(
                    {
                        "title": "Bad Deck",
                        "slides": [
                            {"type": "title", "title": "Core insights on X", "speaker_notes": "too short"}
                        ],
                    }
                )
            return json.dumps(
                {
                    "title": "B-Tree vs LSM-Tree",
                    "slides": [
                        {
                            "type": "title",
                            "title": "B-Tree vs LSM-Tree Storage Engines",
                            "subtitle": "Read/write amplification and Big-O trade-offs",
                            "speaker_notes": "Introduce B-Trees and LSM-Trees and explain why storage workloads dictate engine selection.",
                        },
                        {
                            "type": "table",
                            "title": "Core Complexity & I/O Matrix",
                            "headers": ["Dimension", "B-Tree", "LSM-Tree"],
                            "rows": [
                                ["Point Read", "O(log_B N)", "O(L * log N) + Bloom filters"],
                                ["Write Path", "In-place 4-16 KB page update", "Sequential WAL + MemTable"],
                            ],
                            "speaker_notes": "Walk through point reads versus sequential writes and highlight background compaction costs.",
                        },
                    ],
                }
            )

        deck = pptgen.generate_validated_deck_json(
            user_prompt="Create a 2-slide technical presentation comparing B-Tree vs LSM-Tree",
            preset_num_slides=8,
            call_ollama_fn=fake_ollama,
        )
        self.assertEqual(len(calls), 2)
        self.assertEqual(len(deck["slides"]), 2)
        self.assertEqual(deck["slides"][1]["type"], "table")


if __name__ == "__main__":
    unittest.main()
