"""Tests for tools/ai/translators.py — typed JSON → JSON Patch (HLR-019, HLR-051)."""
from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401

from ai import translators
from ai.registry import get_intent
from render_doc import init_project


class TranslatorFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="tracer-ai-trans-"))
        self.xml = self.tmp / "Project.xml"
        init_project(
            name="Trans Test",
            short_name="TT",
            author="tester",
            xml_path=self.xml,
            pvd_path=self.tmp / "PVD.md",
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)


class DraftHlrTests(TranslatorFixture):
    def test_emits_append_op_with_allocated_id(self) -> None:
        ops = translators.translate(
            get_intent("draft.hlr"),
            {"name": "Sample HLR", "text": "The system SHALL do X.",
             "traces": [{"target": "SDD", "ref": "tools/x.py"}]},
            xml_path=self.xml, target_type="Hlr", target_section="1",
        )
        self.assertEqual(len(ops), 1)
        op = ops[0]
        self.assertEqual(op["op"], "add")
        self.assertEqual(op["path"], "/hlrs/section[number=1]/hlr/-")
        value = op["value"]
        self.assertTrue(value["@id"].startswith("HLR-"))
        self.assertEqual(value["@name"], "Sample HLR")
        self.assertEqual(value["text"], "The system SHALL do X.")
        self.assertEqual(value["traces"]["trace"][0]["@target"], "SDD")

    def test_missing_required_field_raises(self) -> None:
        with self.assertRaises(translators.TranslatorError):
            translators.translate(
                get_intent("draft.hlr"),
                {"text": "no name"},
                xml_path=self.xml, target_type="Hlr", target_section="1",
            )


class DraftLlrTests(TranslatorFixture):
    def test_requires_target_section(self) -> None:
        with self.assertRaises(translators.TranslatorError):
            translators.translate(
                get_intent("draft.llr"),
                {"text": "Body."},
                xml_path=self.xml, target_type="Llr",
            )


class SuggestTracesTests(TranslatorFixture):
    def test_emits_replace_on_traces_block(self) -> None:
        ops = translators.translate(
            get_intent("suggest.traces"),
            {"traces": [{"target": "SDD", "ref": "tools/x.py"}]},
            xml_path=self.xml, target_type="Hlr",
            target_id="HLR-001", target_section="1",
        )
        self.assertEqual(len(ops), 1)
        self.assertEqual(ops[0]["op"], "replace")
        self.assertIn("hlr[id=HLR-001]/traces", ops[0]["path"])

    def test_unknown_target_type_raises(self) -> None:
        with self.assertRaises(translators.TranslatorError):
            translators.translate(
                get_intent("suggest.traces"),
                {"traces": [{"target": "SDD", "ref": "x"}]},
                xml_path=self.xml, target_type="Hlr",
                target_id=None, target_section="1",
            )


class GapFixTests(TranslatorFixture):
    def test_dispatches_to_llr_when_kind_llr(self) -> None:
        ops = translators.translate(
            get_intent("gap.fix"),
            {"kind": "llr", "llr": {"text": "fixes the gap thoroughly"}},
            xml_path=self.xml, target_type="Llr", target_section="PCL",
        )
        self.assertEqual(ops[0]["op"], "add")
        self.assertIn("function[name=PCL]/llr/-", ops[0]["path"])


if __name__ == "__main__":
    unittest.main()
