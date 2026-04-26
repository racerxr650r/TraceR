"""Tests for the project_io ai_request JSON-RPC method (HLR-029..033)."""
from __future__ import annotations

import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401

import project_io
from project_edit import apply_edit
from render_doc import init_project


class AiRequestSidecarTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="tracer-ai-rpc-"))
        self.xml = self.tmp / "Project.xml"
        init_project(
            name="RPC Test",
            short_name="RT",
            author="tester",
            xml_path=self.xml,
            pvd_path=self.tmp / "PVD.md",
        )
        apply_edit(
            [{"op": "add", "path": "/hlrs/section/-", "value": {"@number": "1", "@title": "Test"}}],
            xml_path=self.xml,
            expect_clean=True,
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _rpc(self, method: str, **params) -> dict:
        line = json.dumps({"id": 1, "method": method, "params": params}) + "\n"
        out = io.StringIO()
        project_io.serve(stdin=io.StringIO(line), stdout=out)
        return json.loads(out.getvalue().splitlines()[0])

    def test_first_call_returns_prompt(self) -> None:
        resp = self._rpc(
            "ai_request",
            intent="draft.hlr",
            target={"type": "Hlr", "section": "1"},
            user_prompt="Add a new HLR.",
            xml_path=str(self.xml),
            history_dir=str(self.tmp),
        )
        result = resp["result"]
        self.assertEqual(result["kind"], "prompt")
        self.assertIn("prompt", result)
        self.assertIn("Add a new HLR.", result["prompt"])

    def test_evaluate_with_good_response_applies_and_writes_provenance(self) -> None:
        good = json.dumps({
            "name": "From RPC",
            "text": "The system SHALL accept ai_request from JSON-RPC.",
        })
        resp = self._rpc(
            "ai_request",
            intent="draft.hlr",
            target={"type": "Hlr", "section": "1"},
            user_prompt="Add an HLR.",
            model_response=good,
            xml_path=str(self.xml),
            history_dir=str(self.tmp),
        )
        result = resp["result"]
        self.assertIn(result["kind"], {"applied", "validated"})
        self.assertIn("From RPC", self.xml.read_text())
        log = self.tmp / ".edit_doc" / "ai_history.jsonl"
        self.assertTrue(log.exists())
        rec = json.loads(log.read_text().splitlines()[0])
        self.assertEqual(rec["intent"], "draft.hlr")

    def test_unknown_intent_returns_invalid_params(self) -> None:
        resp = self._rpc(
            "ai_request",
            intent="not.an.intent",
            target={"type": "Hlr", "section": "1"},
            user_prompt="x",
            xml_path=str(self.xml),
        )
        self.assertEqual(resp["error"]["code"], project_io.INVALID_PARAMS)

    def test_missing_target_returns_invalid_params(self) -> None:
        resp = self._rpc(
            "ai_request",
            intent="draft.hlr",
            user_prompt="x",
            xml_path=str(self.xml),
        )
        self.assertEqual(resp["error"]["code"], project_io.INVALID_PARAMS)


if __name__ == "__main__":
    unittest.main()
