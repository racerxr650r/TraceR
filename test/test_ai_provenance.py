"""Tests for tools/ai/provenance.py — JSONL audit log (HLR-049)."""
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401

from ai import provenance


class ProvenanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="tracer-ai-prov-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_append_record_writes_jsonl_line(self) -> None:
        provenance.append_record(
            workspace_root=self.tmp,
            intent="draft.hlr",
            outcome="applied",
            prompt="hello world",
            model="test-model",
            retries=0,
            validator={"errors": 0, "warnings": 0, "ok": True},
            patch=[{"op": "add", "path": "/x/-", "value": {"@id": "HLR-001"}}],
            target={"type": "Hlr"},
            enabled=True,
        )
        records = list(provenance.read_records(self.tmp))
        self.assertEqual(len(records), 1)
        rec = records[0]
        self.assertEqual(rec["intent"], "draft.hlr")
        self.assertEqual(rec["outcome"], "applied")
        self.assertEqual(rec["model"], "test-model")
        self.assertIn("prompt_sha256", rec)
        self.assertNotIn("prompt", rec)  # never stored in plaintext

    def test_disabled_is_no_op(self) -> None:
        provenance.append_record(
            workspace_root=self.tmp,
            intent="draft.hlr",
            outcome="applied",
            prompt="hi", model="m", retries=0,
            validator=None, patch=None, target={"type": "Hlr"},
            enabled=False,
        )
        records = list(provenance.read_records(self.tmp))
        self.assertEqual(records, [])

    def test_append_record_is_jsonl(self) -> None:
        for i in range(3):
            provenance.append_record(
                workspace_root=self.tmp,
                intent="draft.hlr", outcome="applied",
                prompt=f"p{i}", model="m", retries=i,
                validator=None, patch=None, target={"type": "Hlr"},
                enabled=True,
            )
        log = (self.tmp / ".edit_doc" / "ai_history.jsonl").read_text()
        lines = [l for l in log.splitlines() if l.strip()]
        self.assertEqual(len(lines), 3)
        for line in lines:
            json.loads(line)  # each line must be valid JSON


if __name__ == "__main__":
    unittest.main()
