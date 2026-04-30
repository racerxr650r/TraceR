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

    def test_dispatches_to_test_when_kind_test(self) -> None:
        ops = translators.translate(
            get_intent("gap.fix"),
            {"kind": "test", "test": {
                "name": "test_something",
                "purpose": "Verifies something important works.",
                "traces": [{"target": "LLR", "ref": "LLR-PCL-01"}],
            }},
            xml_path=self.xml, target_type="Test",
            target_file="test/test_x.py",
        )
        self.assertEqual(len(ops), 1)
        self.assertEqual(ops[0]["op"], "add")
        self.assertIn("file[path=test/test_x.py]/test/-", ops[0]["path"])

    def test_cascade_test_with_new_llr(self) -> None:
        """When test references $new_llr, the translator creates the LLR
        first and resolves the placeholder to its allocated id."""
        ops = translators.translate(
            get_intent("gap.fix"),
            {
                "kind": "test",
                "test": {
                    "name": "test_cascade",
                    "purpose": "Verifies cascade creation works.",
                    "traces": [{"target": "LLR", "ref": "$new_llr"}],
                },
                "new_llr": {
                    "text": "The system SHALL support cascading creation.",
                    "traces": [{"target": "HLR", "ref": "HLR-001"}],
                },
            },
            xml_path=self.xml, target_type="Test",
            target_file="test/test_x.py", target_section="GEN",
        )
        # Two ops: LLR add, then test add.
        self.assertEqual(len(ops), 2)
        self.assertEqual(ops[0]["op"], "add")
        self.assertIn("/llr/-", ops[0]["path"])
        llr_id = ops[0]["value"]["@id"]
        self.assertTrue(llr_id.startswith("LLR-"))
        # Test's trace ref should be resolved to the LLR id.
        self.assertEqual(ops[1]["op"], "add")
        test_traces = ops[1]["value"]["traces"]["trace"]
        self.assertEqual(test_traces[0]["@ref"], llr_id)

    def test_cascade_test_with_new_llr_and_new_hlr(self) -> None:
        """Full cascade: new_hlr → new_llr → test."""
        ops = translators.translate(
            get_intent("gap.fix"),
            {
                "kind": "test",
                "test": {
                    "name": "test_full_cascade",
                    "purpose": "Verifies full cascade with new HLR and LLR.",
                    "traces": [{"target": "LLR", "ref": "$new_llr"}],
                },
                "new_llr": {
                    "text": "The system SHALL validate input schemas.",
                    "traces": [{"target": "HLR", "ref": "$new_hlr"}],
                },
                "new_hlr": {
                    "name": "Input Validation",
                    "text": "The system shall validate all external inputs against declared schemas.",
                    "traces": [{"target": "SDD", "ref": "src/validate.ts"}],
                },
            },
            xml_path=self.xml, target_type="Test",
            target_file="test/test_x.py", target_section="GEN",
        )
        # Three ops: HLR, LLR, test.
        self.assertEqual(len(ops), 3)
        # HLR created first.
        self.assertEqual(ops[0]["op"], "add")
        self.assertIn("/hlr/-", ops[0]["path"])
        hlr_id = ops[0]["value"]["@id"]
        self.assertTrue(hlr_id.startswith("HLR-"))
        # LLR traces resolved to the new HLR id.
        self.assertEqual(ops[1]["op"], "add")
        self.assertIn("/llr/-", ops[1]["path"])
        llr_id = ops[1]["value"]["@id"]
        llr_traces = ops[1]["value"]["traces"]["trace"]
        self.assertEqual(llr_traces[0]["@ref"], hlr_id)
        # Test traces resolved to the new LLR id.
        self.assertEqual(ops[2]["op"], "add")
        test_traces = ops[2]["value"]["traces"]["trace"]
        self.assertEqual(test_traces[0]["@ref"], llr_id)

    def test_cascade_with_new_module(self) -> None:
        """Full cascade including new SDD module."""
        ops = translators.translate(
            get_intent("gap.fix"),
            {
                "kind": "test",
                "test": {
                    "name": "test_telemetry_flush",
                    "purpose": "Verifies telemetry events flush on exit.",
                    "traces": [{"target": "LLR", "ref": "$new_llr"}],
                },
                "new_llr": {
                    "text": "The telemetry module SHALL flush on exit.",
                    "traces": [{"target": "HLR", "ref": "$new_hlr"}],
                },
                "new_hlr": {
                    "name": "Telemetry Flush",
                    "text": "The system shall flush buffered telemetry on shutdown.",
                    "traces": [{"target": "SDD", "ref": "$new_module"}],
                },
                "new_module": {
                    "path": "src/telemetry/flush.ts",
                    "title": "Telemetry flush handler",
                    "purpose": "Drains the buffer on shutdown.",
                },
            },
            xml_path=self.xml, target_type="Test",
            target_file="test/test_x.py", target_section="GEN",
        )
        # Four ops: module, HLR, LLR, test.
        self.assertEqual(len(ops), 4)
        # Module op.
        self.assertEqual(ops[0]["op"], "add")
        self.assertIn("/sdd/modules/module/-", ops[0]["path"])
        self.assertEqual(ops[0]["value"]["@path"], "src/telemetry/flush.ts")
        # HLR traces resolved to module path.
        hlr_traces = ops[1]["value"]["traces"]["trace"]
        self.assertEqual(hlr_traces[0]["@ref"], "src/telemetry/flush.ts")
        # LLR traces resolved to HLR id.
        hlr_id = ops[1]["value"]["@id"]
        llr_traces = ops[2]["value"]["traces"]["trace"]
        self.assertEqual(llr_traces[0]["@ref"], hlr_id)
        # Test traces resolved to LLR id.
        llr_id = ops[2]["value"]["@id"]
        test_traces = ops[3]["value"]["traces"]["trace"]
        self.assertEqual(test_traces[0]["@ref"], llr_id)

    def test_unsupported_kind_raises(self) -> None:
        with self.assertRaises(translators.TranslatorError):
            translators.translate(
                get_intent("gap.fix"),
                {"kind": "bogus"},
                xml_path=self.xml, target_type="Hlr",
            )


if __name__ == "__main__":
    unittest.main()
