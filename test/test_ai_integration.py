"""Record/replay integration tests for the AI authoring pipeline (Phase 11).

Each test loads a curated fixture pair (bundle + response) from
``test/fixtures/ai_recordings/``, replays the response through the
translator → apply_edit path, and asserts that:

* The translator produces well-formed JSON Patch operations.
* ``apply_edit`` writes lint-clean XML (no error-severity findings).
* Expected elements appear in the resulting ``Project.xml``.
* Placeholder references (``$new_llr``, ``$new_hlr``, ``$new_module``)
  are resolved to allocated IDs before the patch is applied.
"""
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401  — adds tools/ to sys.path

from ai import translators
from ai.registry import get_intent
from project_edit import apply_edit
from render_doc import init_project

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "ai_recordings"


def _load_fixture(name: str) -> tuple[dict, dict]:
    """Return (bundle, response) for the named fixture."""
    bundle = json.loads((FIXTURES_DIR / f"{name}.bundle.json").read_text())
    response = json.loads((FIXTURES_DIR / f"{name}.response.json").read_text())
    return bundle, response


class ReplayFixture(unittest.TestCase):
    """Base class: creates a temp Project.xml and bootstraps containers."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="tracer-ai-replay-"))
        self.xml = self.tmp / "Project.xml"
        init_project(
            name="Replay Test",
            short_name="RT",
            author="tester",
            xml_path=self.xml,
            pvd_path=self.tmp / "PVD.md",
        )
        # Bootstrap containers that the translators append into.
        apply_edit(
            [{"op": "add", "path": "/hlrs/section/-",
              "value": {"@number": "1", "@title": "General"}}],
            xml_path=self.xml, expect_clean=True,
        )
        # Seed HLR so traces referencing HLR-001 are valid.
        apply_edit(
            [{"op": "add", "path": "/hlrs/section[number=1]/hlr/-",
              "value": {"@id": "HLR-001", "@name": "Seed HLR",
                        "text": "The system SHALL exist.",
                        "traces": {"trace": [{"@target": "SDD",
                                              "@ref": "1.1"}]}}}],
            xml_path=self.xml, expect_clean=True,
        )
        # Bootstrap <modules> inside <sdd> with a seed module so XSD is happy.
        apply_edit(
            [{"op": "add", "path": "/sdd/modules",
              "value": {"module": {"@path": "seed/placeholder.ts",
                                   "@title": "Seed module"}}}],
            xml_path=self.xml, expect_clean=True,
        )
        # Seed LLR function + LLR so traces referencing LLR-GEN-01 are valid.
        apply_edit(
            [{"op": "add", "path": "/llrs/function/-",
              "value": {"@name": "GEN", "@number": "1", "@title": "General"}}],
            xml_path=self.xml, expect_clean=True,
        )
        apply_edit(
            [{"op": "add", "path": "/llrs/function[name=GEN]/llr/-",
              "value": {"@id": "LLR-GEN-01",
                        "text": "Seed LLR for trace targets.",
                        "traces": {"trace": [{"@target": "HLR",
                                              "@ref": "HLR-001"}]}}}],
            xml_path=self.xml, expect_clean=True,
        )
        # Seed test file container.
        apply_edit(
            [{"op": "add", "path": "/tests/file/-",
              "value": {"@path": "test/test_render_doc.py"}}],
            xml_path=self.xml, expect_clean=True,
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ---------------------------------------------------------------- #
    # Helpers                                                            #
    # ---------------------------------------------------------------- #

    def _replay(self, fixture_name: str) -> list[dict]:
        """Load a fixture, translate, apply, and return the ops."""
        bundle, response = _load_fixture(fixture_name)
        intent = get_intent(bundle["intent"])
        target = bundle["target"]

        ops = translators.translate(
            intent,
            response,
            xml_path=self.xml,
            target_type=target.get("type", ""),
            target_id=target.get("id"),
            target_section=target.get("section"),
            target_file=target.get("file"),
        )
        self.assertTrue(ops, f"translator for {fixture_name} returned no ops")

        result = apply_edit(ops, xml_path=self.xml, expect_clean=True)
        self.assertTrue(
            result.written,
            f"apply_edit rejected {fixture_name}: {result.findings}",
        )
        return ops

    def _xml_text(self) -> str:
        return self.xml.read_text(encoding="utf-8")


# ================================================================== #
# Draft intents                                                       #
# ================================================================== #

class DraftHlrReplayTests(ReplayFixture):
    def test_replay_produces_hlr_element(self) -> None:
        self._replay("draft_hlr")
        xml = self._xml_text()
        self.assertIn("Widget Configuration", xml)
        self.assertIn("HLR-", xml)

    def test_ops_structure(self) -> None:
        ops = self._replay("draft_hlr")
        self.assertEqual(len(ops), 1)
        self.assertEqual(ops[0]["op"], "add")
        self.assertIn("section[number=1]", ops[0]["path"])


class DraftLlrReplayTests(ReplayFixture):
    def setUp(self) -> None:
        super().setUp()
        # Need a PCL function container (GEN already exists from base).
        apply_edit(
            [{"op": "add", "path": "/llrs/function/-",
              "value": {"@name": "PCL", "@number": "2", "@title": "Pipeline Control"}}],
            xml_path=self.xml, expect_clean=True,
        )

    def test_replay_produces_llr_element(self) -> None:
        self._replay("draft_llr")
        xml = self._xml_text()
        self.assertIn("LLR-PCL-", xml)
        self.assertIn("render_doc.render() SHALL validate", xml)


class DraftTestReplayTests(ReplayFixture):
    def test_replay_produces_test_element(self) -> None:
        self._replay("draft_test")
        xml = self._xml_text()
        self.assertIn("test_render_produces_valid_output", xml)


class DraftModuleReplayTests(ReplayFixture):
    def test_replay_produces_module_element(self) -> None:
        self._replay("draft_module")
        xml = self._xml_text()
        self.assertIn("src/validators/schema.ts", xml)
        self.assertIn("Schema Validator", xml)


# ================================================================== #
# Suggest traces                                                      #
# ================================================================== #

class SuggestTracesReplayTests(ReplayFixture):
    def test_replay_replaces_traces(self) -> None:
        ops = self._replay("suggest_traces")
        self.assertEqual(ops[0]["op"], "replace")
        xml = self._xml_text()
        self.assertIn("1.1", xml)


# ================================================================== #
# Review (advisory — no patch, so we only test translator returns [])  #
# ================================================================== #

class ReviewItemReplayTests(ReplayFixture):
    def test_advisory_has_no_translator(self) -> None:
        """Advisory intents have no JSON Patch translator."""
        bundle, response = _load_fixture("review_item")
        intent = get_intent(bundle["intent"])
        self.assertFalse(translators.has_translator(intent))

    def test_response_has_findings(self) -> None:
        _, response = _load_fixture("review_item")
        self.assertIn("findings", response)
        self.assertGreater(len(response["findings"]), 0)


# ================================================================== #
# Expand intents                                                      #
# ================================================================== #

class ExpandHlrToLlrsReplayTests(ReplayFixture):
    def test_replay_produces_llr_candidates(self) -> None:
        ops = self._replay("expand_hlr_to_llrs")
        self.assertEqual(len(ops), 1)
        xml = self._xml_text()
        self.assertIn("LLR-GEN-", xml)
        self.assertIn("render_doc SHALL accept a --format flag", xml)


class ExpandLlrToTestsReplayTests(ReplayFixture):
    def test_replay_produces_test_candidates(self) -> None:
        ops = self._replay("expand_llr_to_tests")
        self.assertEqual(len(ops), 1)
        xml = self._xml_text()
        self.assertIn("test_gen_accepts_format_flag", xml)


# ================================================================== #
# Gap-fix intents (simple and cascading)                              #
# ================================================================== #

class GapFixLlrReplayTests(ReplayFixture):
    def setUp(self) -> None:
        super().setUp()
        apply_edit(
            [{"op": "add", "path": "/llrs/function/-",
              "value": {"@name": "PCL", "@number": "2", "@title": "Pipeline Control"}}],
            xml_path=self.xml, expect_clean=True,
        )

    def test_replay_creates_llr(self) -> None:
        ops = self._replay("gap_fix_llr")
        self.assertEqual(len(ops), 1)
        self.assertEqual(ops[0]["op"], "add")
        xml = self._xml_text()
        self.assertIn("LLR-PCL-", xml)


class GapFixTestReplayTests(ReplayFixture):
    def test_replay_creates_test(self) -> None:
        ops = self._replay("gap_fix_test")
        self.assertEqual(len(ops), 1)
        xml = self._xml_text()
        self.assertIn("test_xsd_validation_failure", xml)


class GapFixCascadeReplayTests(ReplayFixture):
    """Full cascade: new_module → new_hlr → new_llr → test."""


    def test_replay_creates_four_ops(self) -> None:
        ops = self._replay("gap_fix_cascade")
        # module + HLR + LLR + test = 4 ops
        self.assertEqual(len(ops), 4)

    def test_placeholder_resolution(self) -> None:
        ops = self._replay("gap_fix_cascade")
        # HLR traces should point to the module path, not $new_module.
        hlr_traces = ops[1]["value"]["traces"]["trace"]
        self.assertNotIn("$new_module", str(hlr_traces))
        self.assertIn("src/telemetry/render.ts", str(hlr_traces))

        # LLR traces should point to the HLR id, not $new_hlr.
        llr_traces = ops[2]["value"]["traces"]["trace"]
        self.assertNotIn("$new_hlr", str(llr_traces))
        hlr_id = ops[1]["value"]["@id"]
        self.assertEqual(llr_traces[0]["@ref"], hlr_id)

        # Test traces should point to the LLR id, not $new_llr.
        test_traces = ops[3]["value"]["traces"]["trace"]
        self.assertNotIn("$new_llr", str(test_traces))
        llr_id = ops[2]["value"]["@id"]
        self.assertEqual(test_traces[0]["@ref"], llr_id)

    def test_no_unresolved_placeholders_in_xml(self) -> None:
        self._replay("gap_fix_cascade")
        xml = self._xml_text()
        self.assertNotIn("$new_", xml)

    def test_lint_clean(self) -> None:
        """The resulting XML should pass lint with no error findings."""
        self._replay("gap_fix_cascade")
        # apply_edit already enforces expect_clean=True, so if we get
        # here the XML is lint-clean. Verify explicitly anyway.
        from lint_project import lint
        findings = lint(xml_path=self.xml)
        self.assertEqual(findings.errors, [], f"lint errors after cascade: {findings.errors}")


# ================================================================== #
# Recording capability unit tests                                     #
# ================================================================== #

class RecordExchangeTests(unittest.TestCase):
    """Tests for the pipeline.record_exchange() function."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="tracer-ai-rec-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_writes_bundle_and_response(self) -> None:
        from ai import pipeline
        from ai.context import TargetSpec, Bundle

        target = TargetSpec(type="Hlr", section="1")
        bundle = Bundle(
            intent="draft.hlr",
            user_prompt="Write an HLR.",
            target=target.to_dict(),
            schema_excerpt="<section/>",
            response_schema={},
            next_free_ids={"hlr": "HLR-001"},
        )

        stem = pipeline.record_exchange(
            "draft.hlr",
            target,
            bundle,
            '{"name": "X", "text": "Y"}',
            {"name": "X", "text": "Y"},
            record_dir=self.tmp,
        )
        self.assertIsNotNone(stem)
        bundle_path = stem.with_suffix(".bundle.json")
        response_path = stem.with_suffix(".response.json")
        self.assertTrue(bundle_path.exists())
        self.assertTrue(response_path.exists())

        b = json.loads(bundle_path.read_text())
        self.assertEqual(b["intent"], "draft.hlr")
        r = json.loads(response_path.read_text())
        self.assertEqual(r["name"], "X")

    def test_returns_none_when_no_record_dir(self) -> None:
        from ai import pipeline
        from ai.context import TargetSpec, Bundle
        import os

        os.environ.pop("TRACER_AI_RECORD_DIR", None)
        target = TargetSpec(type="Hlr")
        bundle = Bundle(
            intent="draft.hlr",
            user_prompt="",
            target=target.to_dict(),
            schema_excerpt="",
            response_schema={},
        )
        result = pipeline.record_exchange(
            "draft.hlr", target, bundle, "{}", {},
        )
        self.assertIsNone(result)

    def test_env_var_triggers_recording(self) -> None:
        from ai import pipeline
        from ai.context import TargetSpec, Bundle
        import os

        rec_dir = self.tmp / "env_rec"
        os.environ["TRACER_AI_RECORD_DIR"] = str(rec_dir)
        try:
            target = TargetSpec(type="Hlr")
            bundle = Bundle(
                intent="draft.hlr",
                user_prompt="",
                target=target.to_dict(),
                schema_excerpt="",
                response_schema={},
            )
            stem = pipeline.record_exchange(
                "draft.hlr", target, bundle, '{"a":1}', {"a": 1},
            )
            self.assertIsNotNone(stem)
            self.assertTrue(rec_dir.exists())
        finally:
            os.environ.pop("TRACER_AI_RECORD_DIR", None)


if __name__ == "__main__":
    unittest.main()
