"""Tests for tools/project_merge.py — Phase 5.5 deterministic three-way
structural merger plus the four ``merge.*`` AI intent shells.
"""
from __future__ import annotations

import shutil
import tempfile
import textwrap
import unittest
from pathlib import Path

from _paths import PROJECT_XSD  # noqa: F401  (sys.path injection)

from project_merge import (
    Conflict,
    MergeResult,
    apply_resolution,
    merge_three_way,
)


def _project(*, hlrs: str = "", llrs: str = "", tests: str = "",
             schema_version: str = "1.5", counts: bool = True) -> str:
    """Build a minimal lint-clean Project.xml string for the merger tests."""
    counts_block = (
        "    <counts>\n"
        "      <hlrs>0</hlrs>\n"
        "      <llrs>0</llrs>\n"
        "      <tests>0</tests>\n"
        "      <modules>0</modules>\n"
        "      <fixtures>0</fixtures>\n"
        "    </counts>\n"
        if counts else ""
    )
    return (
        "<?xml version='1.0' encoding='UTF-8'?>\n"
        f'<project name="MergeFixture" short_name="mf" schema_version="{schema_version}"\n'
        '         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n'
        '         xsi:noNamespaceSchemaLocation="project.xsd">\n'
        "  <metadata>\n"
        '    <document id="SDD"  title="SDD"  source="SDD.md"  version="0.1" date="2026-04-24" author="t"/>\n'
        '    <document id="HLRs" title="HLRs" source="HLRs.md" version="0.1" date="2026-04-24" author="t"/>\n'
        '    <document id="LLRs" title="LLRs" source="LLRs.md" version="0.1" date="2026-04-24" author="t"/>\n'
        '    <document id="STP"  title="STP"  source="STP.md"  version="0.1" date="2026-04-24" author="t"/>\n'
        '    <document id="Traceability" title="Trace" source="Trace.md" version="0.1" date="2026-04-24" author="t"/>\n'
        f"{counts_block}"
        "  </metadata>\n"
        "  <sdd></sdd>\n"
        "  <stp></stp>\n"
        "  <hlrs>\n"
        '    <section number="1" title="Function 1">\n'
        "      <intro>n/a</intro>\n"
        f"{hlrs}"
        "    </section>\n"
        "  </hlrs>\n"
        "  <llrs>\n"
        '    <function number="1" title="First function" name="core">\n'
        f"{llrs}"
        "    </function>\n"
        "  </llrs>\n"
        "  <tests>\n"
        '    <file path="test/test_fixture.py">\n'
        f"{tests}"
        "    </file>\n"
        "  </tests>\n"
        "</project>\n"
    )


_HLR_ONE = (
    '      <hlr id="HLR-001" name="First requirement">\n'
    '        <text>Body of HLR-001.</text>\n'
    '      </hlr>\n'
)


def _hlr(id_: str, name: str, body: str, *, traces: list[tuple[str, str]] | None = None) -> str:
    trace_xml = ""
    if traces:
        rows = "".join(
            f'          <trace target="{t}" ref="{r}"/>\n' for t, r in traces
        )
        trace_xml = f"        <traces>\n{rows}        </traces>\n"
    return (
        f'      <hlr id="{id_}" name="{name}">\n'
        f'        <text>{body}</text>\n'
        f'{trace_xml}'
        f'      </hlr>\n'
    )


def _llr(id_: str, body: str, *, traces: list[tuple[str, str]] | None = None) -> str:
    trace_xml = ""
    if traces:
        rows = "".join(
            f'          <trace target="{t}" ref="{r}"/>\n' for t, r in traces
        )
        trace_xml = f"        <traces>\n{rows}        </traces>\n"
    return (
        f'      <llr id="{id_}">\n'
        f'        <text>{body}</text>\n'
        f'{trace_xml}'
        f'      </llr>\n'
    )


def _test_entry(name: str, purpose: str, *, traces: list[tuple[str, str]] | None = None) -> str:
    trace_xml = ""
    if traces:
        rows = "".join(
            f'          <trace target="{t}" ref="{r}"/>\n' for t, r in traces
        )
        trace_xml = f"        <traces>\n{rows}        </traces>\n"
    return (
        f'      <test name="{name}">\n'
        f'        <purpose>{purpose}</purpose>\n'
        f'{trace_xml}'
        f'      </test>\n'
    )


class _XsdMixin:
    """Provide an xsd_path so the merger's lint pass has a real schema."""
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.xsd_path = Path(cls._tmp.name) / "project.xsd"
        shutil.copy(Path(PROJECT_XSD), cls.xsd_path)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()


class CleanMergeTests(_XsdMixin, unittest.TestCase):
    """Acceptance: two branches each adding a non-overlapping HLR to
    the same `<hlrs>/<section>` produce a clean merge with no AI
    involvement."""

    def test_disjoint_adds_union(self):
        base = _project(hlrs=_HLR_ONE)
        ours = _project(hlrs=_HLR_ONE + _hlr(
            "HLR-002", "Ours add", "Body of HLR-002.",
            traces=[("SDD", "tools/render_doc.py")],
        ))
        theirs = _project(hlrs=_HLR_ONE + _hlr(
            "HLR-003", "Theirs add", "Body of HLR-003.",
            traces=[("SDD", "tools/render_doc.py")],
        ))
        result = merge_three_way(base, ours, theirs, xsd_path=self.xsd_path)
        self.assertFalse(result.refused)
        self.assertEqual(result.residual_conflicts, [])
        self.assertIn("HLR-002", result.merged_xml)
        self.assertIn("HLR-003", result.merged_xml)
        self.assertGreaterEqual(result.auto_resolved, 1)

    def test_traces_unioned_by_target_ref(self):
        base = _project(hlrs=_hlr("HLR-001", "n", "b",
                                  traces=[("SDD", "tools/a.py")]))
        ours = _project(hlrs=_hlr("HLR-001", "n", "b",
                                  traces=[("SDD", "tools/a.py"),
                                          ("SDD", "tools/b.py")]))
        theirs = _project(hlrs=_hlr("HLR-001", "n", "b",
                                    traces=[("SDD", "tools/a.py"),
                                            ("PVD", "5")]))
        result = merge_three_way(base, ours, theirs, xsd_path=self.xsd_path)
        self.assertFalse(result.refused)
        self.assertEqual(result.residual_conflicts, [])
        self.assertIn('ref="tools/b.py"', result.merged_xml)
        self.assertIn('ref="5"', result.merged_xml)


class IdCollisionTests(_XsdMixin, unittest.TestCase):
    """Acceptance: both branches added items with the same id but
    different content → ours keeps the id, theirs is reallocated."""

    def test_renames_theirs_side(self):
        base = _project(hlrs=_HLR_ONE)
        ours = _project(hlrs=_HLR_ONE + _hlr("HLR-002", "Ours", "Ours body"))
        theirs = _project(hlrs=_HLR_ONE + _hlr("HLR-002", "Theirs", "Theirs body"))
        result = merge_three_way(base, ours, theirs, xsd_path=self.xsd_path)
        self.assertEqual(len(result.residual_conflicts), 1)
        c = result.residual_conflicts[0]
        self.assertEqual(c.kind, "id_collision")
        self.assertEqual(c.key, "HLR-002")
        self.assertEqual(c.rename_to, "HLR-003")
        # Both items must appear in merged xml; ours retains the original id.
        self.assertIn('id="HLR-002"', result.merged_xml)
        self.assertIn('id="HLR-003"', result.merged_xml)
        self.assertIn("Ours body", result.merged_xml)
        self.assertIn("Theirs body", result.merged_xml)


class BodyConflictTests(_XsdMixin, unittest.TestCase):
    """Acceptance: two branches edit the body of the same `<hlr>` →
    residual `body` conflict for Stage B (AI or manual)."""

    def test_both_edited_body(self):
        base = _project(hlrs=_hlr("HLR-001", "n", "Original body."))
        ours = _project(hlrs=_hlr("HLR-001", "n", "Ours edit."))
        theirs = _project(hlrs=_hlr("HLR-001", "n", "Theirs edit."))
        result = merge_three_way(base, ours, theirs, xsd_path=self.xsd_path)
        body_conflicts = [c for c in result.residual_conflicts if c.kind == "body"]
        self.assertEqual(len(body_conflicts), 1)
        c = body_conflicts[0]
        self.assertEqual(c.key, "HLR-001")
        self.assertIn("Ours edit.", c.ours)
        self.assertIn("Theirs edit.", c.theirs)

    def test_one_sided_body_change_takes_winner(self):
        base = _project(hlrs=_hlr("HLR-001", "n", "Original body."))
        ours = _project(hlrs=_hlr("HLR-001", "n", "Original body."))
        theirs = _project(hlrs=_hlr("HLR-001", "n", "Theirs edit."))
        result = merge_three_way(base, ours, theirs, xsd_path=self.xsd_path)
        self.assertEqual(result.residual_conflicts, [])
        self.assertIn("Theirs edit.", result.merged_xml)


class ModifyDeleteTests(_XsdMixin, unittest.TestCase):
    def test_modify_delete_surfaces_conflict(self):
        base = _project(hlrs=_HLR_ONE + _hlr("HLR-002", "n", "Original body."))
        ours = _project(hlrs=_HLR_ONE + _hlr("HLR-002", "n", "Edited body."))
        theirs = _project(hlrs=_HLR_ONE)  # deleted HLR-002
        result = merge_three_way(base, ours, theirs, xsd_path=self.xsd_path)
        kinds = {c.kind for c in result.residual_conflicts}
        self.assertIn("modify_delete", kinds)


class MergeBaseRefusalTests(_XsdMixin, unittest.TestCase):
    """Acceptance: when the Git merge base is unavailable the merger
    refuses cleanly (HLR-034)."""

    def test_no_base_refuses(self):
        ours = _project(hlrs=_HLR_ONE)
        theirs = _project(hlrs=_HLR_ONE)
        result = merge_three_way(None, ours, theirs, xsd_path=self.xsd_path)
        self.assertTrue(result.refused)
        self.assertIn("merge base is unavailable", result.refusal)

    def test_empty_base_refuses(self):
        ours = _project(hlrs=_HLR_ONE)
        theirs = _project(hlrs=_HLR_ONE)
        result = merge_three_way("", ours, theirs, xsd_path=self.xsd_path)
        self.assertTrue(result.refused)


class SchemaBumpTests(_XsdMixin, unittest.TestCase):
    def test_three_way_schema_divergence_is_conflict(self):
        base = _project(schema_version="1.4", hlrs=_HLR_ONE)
        ours = _project(schema_version="1.5", hlrs=_HLR_ONE)
        theirs = _project(schema_version="1.6", hlrs=_HLR_ONE)
        result = merge_three_way(base, ours, theirs, xsd_path=self.xsd_path)
        kinds = [c.kind for c in result.residual_conflicts]
        self.assertIn("schema_bump", kinds)

    def test_one_sided_schema_bump_promoted(self):
        base = _project(schema_version="1.5", hlrs=_HLR_ONE)
        ours = _project(schema_version="1.5", hlrs=_HLR_ONE)
        theirs = _project(schema_version="1.6", hlrs=_HLR_ONE)
        result = merge_three_way(base, ours, theirs, xsd_path=self.xsd_path)
        self.assertEqual(result.residual_conflicts, [])
        self.assertIn('schema_version="1.6"', result.merged_xml)


class CountsRecomputedTests(_XsdMixin, unittest.TestCase):
    def test_counts_match_merged_tree(self):
        base = _project(hlrs=_HLR_ONE)
        ours = _project(hlrs=_HLR_ONE + _hlr("HLR-002", "n", "b"))
        theirs = _project(hlrs=_HLR_ONE + _hlr("HLR-003", "n", "b"))
        result = merge_three_way(base, ours, theirs, xsd_path=self.xsd_path)
        # Counts block should reflect the union (3 HLRs).
        self.assertIn("<hlrs>3</hlrs>", result.merged_xml)


class ApplyResolutionTests(_XsdMixin, unittest.TestCase):
    def test_apply_body_resolution(self):
        base = _project(hlrs=_hlr("HLR-001", "n", "Original."))
        ours = _project(hlrs=_hlr("HLR-001", "n", "Ours."))
        theirs = _project(hlrs=_hlr("HLR-001", "n", "Theirs."))
        result = merge_three_way(base, ours, theirs, xsd_path=self.xsd_path)
        body_c = next(c for c in result.residual_conflicts if c.kind == "body")
        new_xml = apply_resolution(
            result.merged_xml,
            body_c,
            {"merged_xml":
                '<hlr id="HLR-001" name="Merged"><text>Merged body.</text></hlr>'},
        )
        self.assertIn("Merged body.", new_xml)
        self.assertNotIn("Ours.", new_xml)

    def test_apply_schema_bump_resolution(self):
        base = _project(schema_version="1.4", hlrs=_HLR_ONE)
        ours = _project(schema_version="1.5", hlrs=_HLR_ONE)
        theirs = _project(schema_version="1.6", hlrs=_HLR_ONE)
        result = merge_three_way(base, ours, theirs, xsd_path=self.xsd_path)
        schema_c = next(c for c in result.residual_conflicts
                        if c.kind == "schema_bump")
        new_xml = apply_resolution(
            result.merged_xml, schema_c, {"schema_version": "1.7"},
        )
        self.assertIn('schema_version="1.7"', new_xml)


class JsonRpcSurfaceTests(_XsdMixin, unittest.TestCase):
    """Smoke-test the JSON-RPC surface added in project_io.py."""

    def test_methods_registered(self):
        import project_io
        self.assertIn("merge_three_way", project_io.METHODS)
        self.assertIn("apply_merge_resolution", project_io.METHODS)

    def test_merge_three_way_handler(self):
        import project_io
        base = _project(hlrs=_HLR_ONE)
        ours = _project(hlrs=_HLR_ONE + _hlr("HLR-002", "n", "b"))
        theirs = _project(hlrs=_HLR_ONE + _hlr("HLR-003", "n", "b"))
        result = project_io._method_merge_three_way({
            "base": base, "ours": ours, "theirs": theirs,
            "xsd_path": str(self.xsd_path),
        })
        self.assertFalse(result["refused"])
        self.assertIn("HLR-002", result["merged_xml"])
        self.assertIn("HLR-003", result["merged_xml"])

    def test_no_base_is_refusal_not_error(self):
        import project_io
        ours = _project(hlrs=_HLR_ONE)
        theirs = _project(hlrs=_HLR_ONE)
        result = project_io._method_merge_three_way({
            "base": None, "ours": ours, "theirs": theirs,
            "xsd_path": str(self.xsd_path),
        })
        self.assertTrue(result["refused"])


class MergeIntentRegistryTests(unittest.TestCase):
    """Pin the four merge intents in the registry (HLR-034 surface)."""

    def test_four_merge_intents_registered(self):
        from ai.registry import INTENTS
        for intent_id in ("merge.body", "merge.trace",
                          "merge.rename", "merge.schema_bump"):
            self.assertIn(intent_id, INTENTS, intent_id)
            spec = INTENTS[intent_id]
            self.assertEqual(spec.kind, "merge")
            self.assertTrue(spec.schema_path.exists(), spec.schema)
            self.assertTrue(spec.prompt_path.exists(), spec.prompt)


if __name__ == "__main__":
    unittest.main()
