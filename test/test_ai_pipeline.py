"""Tests for tools/ai/pipeline.py — validate→retry loop (HLR-030, HLR-031)."""
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401

from ai import pipeline
from ai.context import TargetSpec
from project_edit import apply_edit
from render_doc import init_project


def _bootstrap_section_one(xml: Path) -> None:
    """Add empty `<section number="1">` containers so append paths exist."""
    apply_edit(
        [{"op": "add", "path": "/hlrs/section/-", "value": {"@number": "1", "@title": "Test"}}],
        xml_path=xml,
        expect_clean=True,
    )


class PipelineFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="tracer-ai-pipe-"))
        self.xml = self.tmp / "Project.xml"
        init_project(
            name="Pipe Test",
            short_name="PT",
            author="tester",
            xml_path=self.xml,
            pvd_path=self.tmp / "PVD.md",
        )
        _bootstrap_section_one(self.xml)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)


class PrepareTests(PipelineFixture):
    def test_prepare_returns_prompt(self) -> None:
        step = pipeline.prepare(
            "draft.hlr",
            TargetSpec(type="Hlr", section="1"),
            "Write me an HLR.",
            xml_path=self.xml,
        )
        self.assertEqual(step.kind, "prompt")
        self.assertIsNotNone(step.prompt)
        self.assertIn("Write me an HLR.", step.prompt)


class EvaluateTests(PipelineFixture):
    GOOD_HLR = json.dumps({
        "name": "Sample Requirement",
        "text": "The system SHALL provide a sample behaviour for testing.",
    })

    BAD_HLR_MISSING_FIELD = json.dumps({"name": "Only a name"})

    BAD_HLR_NOT_JSON = "<xml>nope</xml>"

    def test_evaluate_applies_valid_response(self) -> None:
        step = pipeline.evaluate(
            "draft.hlr",
            TargetSpec(type="Hlr", section="1"),
            "Add a sample HLR.",
            self.GOOD_HLR,
            xml_path=self.xml, write=True,
        )
        self.assertIn(step.kind, {"applied", "validated"},
                      msg=f"unexpected kind={step.kind}")
        self.assertIsNotNone(step.result)
        self.assertEqual(step.result.intent, "draft.hlr")
        # File should now contain the new HLR id.
        self.assertIn("Sample Requirement", self.xml.read_text())

    def test_evaluate_dry_run_does_not_write(self) -> None:
        original = self.xml.read_bytes()
        step = pipeline.evaluate(
            "draft.hlr",
            TargetSpec(type="Hlr", section="1"),
            "Add a sample HLR.",
            self.GOOD_HLR,
            xml_path=self.xml, write=False,
        )
        self.assertEqual(step.kind, "validated")
        self.assertEqual(self.xml.read_bytes(), original)

    def test_evaluate_returns_retry_prompt_on_schema_failure(self) -> None:
        step = pipeline.evaluate(
            "draft.hlr",
            TargetSpec(type="Hlr", section="1"),
            "Add a sample HLR.",
            self.BAD_HLR_MISSING_FIELD,
            xml_path=self.xml, retry_count=0, max_retries=2,
        )
        self.assertEqual(step.kind, "prompt")
        self.assertEqual(step.retries, 1)
        self.assertIsNotNone(step.retry_feedback)
        self.assertTrue(any("text" in f for f in step.retry_feedback))

    def test_evaluate_rejects_after_max_retries(self) -> None:
        step = pipeline.evaluate(
            "draft.hlr",
            TargetSpec(type="Hlr", section="1"),
            "Add a sample HLR.",
            self.BAD_HLR_MISSING_FIELD,
            xml_path=self.xml, retry_count=2, max_retries=2,
        )
        self.assertEqual(step.kind, "rejected")
        self.assertIsNotNone(step.result)
        self.assertTrue(step.result.failures)

    def test_evaluate_rejects_xml_response(self) -> None:
        step = pipeline.evaluate(
            "draft.hlr",
            TargetSpec(type="Hlr", section="1"),
            "Add a sample HLR.",
            self.BAD_HLR_NOT_JSON,
            xml_path=self.xml, retry_count=0, max_retries=0,
        )
        self.assertEqual(step.kind, "rejected")

    def test_advisory_intent_returns_findings_no_patch(self) -> None:
        step = pipeline.evaluate(
            "review.item",
            TargetSpec(type="Hlr", id="HLR-001", section="1"),
            "Review this HLR.",
            json.dumps({"findings": [
                {"severity": "info", "message": "Looks fine."}
            ]}),
            xml_path=self.xml,
        )
        self.assertEqual(step.kind, "advisory")
        self.assertIsNone(step.result.patch)
        self.assertEqual(step.result.advisory[0]["severity"], "info")

    def test_pvd_intent_returns_markdown(self) -> None:
        step = pipeline.evaluate(
            "draft.pvd",
            TargetSpec(type="Pvd", section="vision"),
            "Write the vision.",
            json.dumps({"markdown": "# Vision\n\nA bright future."}),
            xml_path=self.xml,
        )
        self.assertEqual(step.kind, "draft_pvd")
        self.assertIn("Vision", step.result.markdown)


class RunDriverTests(PipelineFixture):
    """End-to-end :func:`pipeline.run` with a stubbed callback."""

    def test_run_with_stubbed_callback_applies(self) -> None:
        good = json.dumps({
            "name": "From Run", "text": "The system SHALL do Y.",
        })
        calls = []
        def cb(prompt, retry):
            calls.append(retry)
            return good
        result = pipeline.run(
            "draft.hlr",
            TargetSpec(type="Hlr", section="1"),
            "Add HLR via run().",
            model_callback=cb,
            xml_path=self.xml,
        )
        self.assertIn(result.kind, {"applied", "validated"})
        self.assertEqual(len(calls), 1)
        self.assertIsNone(calls[0])  # first call has no retry feedback

    def test_run_no_model_returns_no_model(self) -> None:
        def cb(_p, _r):
            raise pipeline.NoModelError("no LM")
        result = pipeline.run(
            "draft.hlr",
            TargetSpec(type="Hlr", section="1"),
            "Add HLR.",
            model_callback=cb,
            xml_path=self.xml,
        )
        self.assertEqual(result.kind, "no-model")

    def test_run_retries_then_accepts(self) -> None:
        good = json.dumps({"name": "Eventually", "text": "The system SHALL eventually do Z."})
        bad = json.dumps({"name": "Bad"})  # missing text
        responses = [bad, good, good]  # extra in case retry asks again
        def cb(_p, retry):
            return responses.pop(0)
        result = pipeline.run(
            "draft.hlr",
            TargetSpec(type="Hlr", section="1"),
            "Try twice.",
            model_callback=cb,
            xml_path=self.xml,
            max_retries=2,
        )
        self.assertIn(result.kind, {"applied", "validated"})
        self.assertEqual(result.retries, 1)


if __name__ == "__main__":
    unittest.main()
