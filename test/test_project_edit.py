"""Tests for tools/project_edit.py — Phase 3 apply_edit + form schema deriver."""
from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from _paths import PROJECT_XSD  # noqa: F401  (sys.path injection)

from project_edit import (
    ApplyEditResult,
    apply_edit,
    derive_form_schema,
    next_free_hlr_id,
    next_free_llr_id,
    _split_path,
    _parse_predicate,
)


# A minimal but lint-clean Project.xml so the validation gate has
# something realistic to chew on. CDATA, comments, and an
# attribute-rich <hlr> are deliberately included so HLR-018
# (round-trip preservation) can be pinned.
SAMPLE_XML = """<?xml version='1.0' encoding='UTF-8'?>
<!-- Top-of-file comment for HLR-018 round-trip pinning. -->
<project name="Edit Fixture" short_name="ef" schema_version="1.4"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="PROJECT_XSD">
  <metadata>
    <document id="SDD"  title="SDD"  source="SDD.md"  version="0.1" date="2026-04-24" author="t"/>
    <document id="HLRs" title="HLRs" source="HLRs.md" version="0.1" date="2026-04-24" author="t"/>
    <document id="LLRs" title="LLRs" source="LLRs.md" version="0.1" date="2026-04-24" author="t"/>
    <document id="STP"  title="STP"  source="STP.md"  version="0.1" date="2026-04-24" author="t"/>
    <document id="Traceability" title="Trace" source="Trace.md" version="0.1" date="2026-04-24" author="t"/>
  </metadata>
  <sdd>
  </sdd>
  <stp>
  </stp>
  <hlrs>
    <!-- A first section so apply_edit predicates have something to
         match against. -->
    <section number="1" title="Function 1">
      <intro>n/a</intro>
      <hlr id="HLR-001" name="First requirement">
        <text><![CDATA[Body of HLR-001 with <em>markup</em> & a [link](#x).]]></text>
      </hlr>
    </section>
  </hlrs>
  <llrs>
    <function number="1" title="First function" name="core">
      <llr id="LLR-CORE-01">
        <text>Plain body, no CDATA needed.</text>
        <traces>
          <trace target="HLR" ref="HLR-001"/>
        </traces>
      </llr>
    </function>
  </llrs>
  <tests>
    <file path="test/test_fixture.py">
      <test name="test_hlr_001_smoke">
        <purpose>Cover HLR-001 so the baseline fixture lints clean.</purpose>
        <traces>
          <trace target="HLR" ref="HLR-001"/>
          <trace target="LLR" ref="LLR-CORE-01"/>
        </traces>
      </test>
    </file>
  </tests>
</project>
"""


class WorkspaceMixin:
    """Per-test tmpdir holding a copy of project.xsd plus a freshly
    instantiated Project.xml fixture. Subclasses get `self.xml_path`
    and `self.xsd_path` for free.
    """

    def setUp(self) -> None:  # type: ignore[override]
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)  # type: ignore[attr-defined]
        tmp_path = Path(self._tmp.name)
        self.xml_path = tmp_path / "Project.xml"
        self.xsd_path = tmp_path / "project.xsd"
        shutil.copy(Path(PROJECT_XSD), self.xsd_path)
        self.xml_path.write_text(
            SAMPLE_XML.replace("PROJECT_XSD", "project.xsd"),
            encoding="utf-8",
        )


# --------------------------------------------------------------------- #
# Path parser                                                           #
# --------------------------------------------------------------------- #

class PathParserTests(unittest.TestCase):

    def test_split_path_strips_leading_slash(self) -> None:
        self.assertEqual(
            _split_path("/hlrs/section[number=1]/hlr/-"),
            ["hlrs", "section[number=1]", "hlr", "-"],
        )

    def test_split_path_rejects_bare_relative(self) -> None:
        with self.assertRaises(ValueError):
            _split_path("hlrs/section")

    def test_predicate_parses_attr_terms(self) -> None:
        self.assertEqual(
            _parse_predicate("number=1,title=Foo"),
            {"number": "1", "title": "Foo"},
        )

    def test_predicate_parses_index(self) -> None:
        self.assertEqual(_parse_predicate("3"), 3)


# --------------------------------------------------------------------- #
# apply_edit                                                            #
# --------------------------------------------------------------------- #

class ApplyEditTests(WorkspaceMixin, unittest.TestCase):

    def test_replace_attribute_writes_when_clean(self) -> None:
        result = apply_edit(
            [{
                "op": "replace",
                "path": "/hlrs/section[number=1]/hlr[id=HLR-001]/@name",
                "value": "Renamed requirement",
            }],
            xml_path=self.xml_path,
            xsd_path=self.xsd_path,
        )
        self.assertIsInstance(result, ApplyEditResult)
        self.assertTrue(result.ok)
        self.assertTrue(result.written)
        self.assertIn(
            'name="Renamed requirement"',
            self.xml_path.read_text(),
        )

    def test_replace_text_body_with_cdata(self) -> None:
        result = apply_edit(
            [{
                "op": "replace",
                "path": "/hlrs/section[number=1]/hlr[id=HLR-001]/text",
                "value": "New body with <markup> & [a](link).",
            }],
            xml_path=self.xml_path,
            xsd_path=self.xsd_path,
        )
        self.assertTrue(result.ok and result.written)
        body = self.xml_path.read_text()
        # CDATA wrap kicks in because the value contains '<' / '&' / a markdown link.
        self.assertIn("<![CDATA[New body with <markup>", body)

    def test_append_new_hlr(self) -> None:
        result = apply_edit(
            [{
                "op": "add",
                "path": "/hlrs/section[number=1]/hlr/-",
                "value": {
                    "@id": "HLR-002",
                    "@name": "Brand new",
                    "text": "Plain body.",
                },
            }],
            xml_path=self.xml_path,
            xsd_path=self.xsd_path,
            # New HLR has no test yet — that's a warning, not an error.
            expect_clean=False,
        )
        self.assertTrue(result.written)
        body = self.xml_path.read_text()
        self.assertIn('id="HLR-002"', body)
        self.assertIn('name="Brand new"', body)


class ValidationGateTests(WorkspaceMixin, unittest.TestCase):
    """HLR-018, HLR-019: the validate-then-write contract."""

    def test_failed_validation_leaves_file_byte_identical(self) -> None:
        pre = self.xml_path.read_bytes()
        # An HLR id that does not match the HlrId pattern -> XSD failure.
        result = apply_edit(
            [{
                "op": "replace",
                "path": "/hlrs/section[number=1]/hlr[id=HLR-001]/@id",
                "value": "not-an-hlr-id",
            }],
            xml_path=self.xml_path,
            xsd_path=self.xsd_path,
        )
        self.assertFalse(result.ok)
        self.assertFalse(result.written)
        # HLR-018 / HLR-019: the on-disk bytes must be byte-identical.
        self.assertEqual(self.xml_path.read_bytes(), pre)
        self.assertTrue(result.findings["errors"])

    def test_broken_trace_blocks_write(self) -> None:
        pre = self.xml_path.read_bytes()
        result = apply_edit(
            [{
                "op": "add",
                "path": "/llrs/function[number=1]/llr/-",
                "value": {
                    "@id": "LLR-CORE-99",
                    "text": "Plain body.",
                    "traces": {
                        # HLR-999 does not exist — linter must reject the write.
                        "trace": [{"@target": "HLR", "@ref": "HLR-999"}],
                    },
                },
            }],
            xml_path=self.xml_path,
            xsd_path=self.xsd_path,
        )
        self.assertFalse(result.ok)
        self.assertFalse(result.written)
        self.assertEqual(self.xml_path.read_bytes(), pre)


class RoundTripPreservationTests(WorkspaceMixin, unittest.TestCase):
    """HLR-018: existing CDATA and comments survive a round-trip write."""

    def test_roundtrip_preserves_existing_cdata(self) -> None:
        # Mutate one attribute on HLR-001; existing CDATA on the same
        # element's <text> child must survive verbatim.
        apply_edit(
            [{
                "op": "replace",
                "path": "/hlrs/section[number=1]/hlr[id=HLR-001]/@name",
                "value": "Still has CDATA",
            }],
            xml_path=self.xml_path,
            xsd_path=self.xsd_path,
        )
        body = self.xml_path.read_text()
        self.assertIn(
            "<![CDATA[Body of HLR-001 with <em>markup</em>",
            body,
        )

    def test_roundtrip_preserves_top_level_comment(self) -> None:
        apply_edit(
            [{
                "op": "replace",
                "path": "/hlrs/section[number=1]/hlr[id=HLR-001]/@name",
                "value": "Comment-preservation check",
            }],
            xml_path=self.xml_path,
            xsd_path=self.xsd_path,
        )
        body = self.xml_path.read_text()
        self.assertIn(
            "Top-of-file comment for HLR-018 round-trip pinning.",
            body,
        )

    def test_apply_edit_uses_atomic_os_replace(self) -> None:
        # LLR-AED-04: apply_edit must use os.replace for the final write
        # so a partial-write crash cannot corrupt the file.
        import inspect
        src = inspect.getsource(apply_edit)
        self.assertIn(
            "os.replace",
            src,
            "apply_edit must use os.replace for an atomic POSIX write",
        )

    def test_apply_edit_normalizes_indentation(self) -> None:
        # LLR-AED-06: after writing, element lines must have consistent
        # 2-space indentation (i.e. _beautify was called with
        # remove_blank_text + etree.indent).
        apply_edit(
            [{
                "op": "replace",
                "path": "/hlrs/section[number=1]/hlr[id=HLR-001]/@name",
                "value": "Indent check",
            }],
            xml_path=self.xml_path,
            xsd_path=self.xsd_path,
        )
        lines = self.xml_path.read_text(encoding="utf-8").splitlines()
        in_comment = False
        for line in lines:
            stripped = line.lstrip(" ")
            if not stripped or stripped.startswith("<?"):
                continue
            # Skip comment blocks (single-line or multi-line).
            if "<!--" in stripped:
                in_comment = not ("-->" in stripped)
                continue
            if in_comment:
                if "-->" in stripped:
                    in_comment = False
                continue
            # Every element line must start with an even number of spaces.
            indent = len(line) - len(stripped)
            self.assertEqual(
                indent % 2,
                0,
                f"Odd indentation ({indent} spaces) on line: {line!r}",
            )


# --------------------------------------------------------------------- #
# next_free_id (HLR-005)                                                 #
# --------------------------------------------------------------------- #

class NextFreeIdTests(WorkspaceMixin, unittest.TestCase):

    def test_next_free_hlr_id(self) -> None:
        self.assertEqual(next_free_hlr_id(self.xml_path), "HLR-002")

    def test_next_free_llr_id(self) -> None:
        self.assertEqual(
            next_free_llr_id("CORE", self.xml_path),
            "LLR-CORE-02",
        )

    def test_next_free_llr_id_for_unseen_function(self) -> None:
        self.assertEqual(
            next_free_llr_id("NEW", self.xml_path),
            "LLR-NEW-01",
        )

    def test_next_free_llr_id_discovers_established_prefix(self) -> None:
        # LLR-AITR-03: when existing LLRs use a prefix that differs from
        # what would be derived from the function name alone, the
        # established prefix must be reused.
        xml_text = SAMPLE_XML.replace(
            'name="core"', 'name="render_helper"',
        ).replace(
            'id="LLR-CORE-01"', 'id="LLR-PPD-01"',
        ).replace(
            'ref="LLR-CORE-01"', 'ref="LLR-PPD-01"',
        )
        xml_path = Path(self._tmp.name) / "prefixed.xml"
        xml_path.write_text(
            xml_text.replace("PROJECT_XSD", "project.xsd"),
            encoding="utf-8",
        )
        # "render_helper" → would derive "REND" without established-prefix
        # discovery, but existing LLR-PPD-01 establishes the "PPD" prefix.
        result = next_free_llr_id("render_helper", xml_path)
        self.assertEqual(result, "LLR-PPD-02")


# --------------------------------------------------------------------- #
# Form schema deriver                                                   #
# --------------------------------------------------------------------- #

class FormSchemaTests(unittest.TestCase):

    def test_derive_hlr_form_schema_shape(self) -> None:
        out = derive_form_schema("Hlr")
        schema = out["schema"]
        self.assertEqual(schema["type"], "object")
        self.assertIn("id", schema["properties"])
        self.assertIn("name", schema["properties"])
        self.assertIn("text", schema["properties"])
        self.assertIn("traces", schema["properties"])
        # id + name are XSD-required.
        self.assertIn("id", schema["required"])
        self.assertIn("name", schema["required"])
        # cdata fields surface as textarea widgets.
        self.assertEqual(out["uiSchema"]["text"]["ui:widget"], "textarea")
        # id field is a plain string (pattern validation deferred to
        # server-side lint to avoid CSP issues in the webview).
        self.assertEqual(schema["properties"]["id"]["type"], "string")
        # Field order is preserved.
        self.assertEqual(out["uiSchema"]["ui:order"][:2], ["id", "name"])

    def test_derive_llr_form_schema_with_refs(self) -> None:
        refs = {"HLR": ["HLR-001", "HLR-002"]}
        out = derive_form_schema("Llr", refs=refs)
        traces = out["schema"]["properties"]["traces"]
        self.assertEqual(traces["type"], "array")
        # Default trace target = HLR per the LLR ui:form hint.
        self.assertEqual(
            traces["items"]["properties"]["target"]["default"], "HLR",
        )
        # The ref selector enum contains the union of all known ids so
        # that existing values (regardless of target) display correctly.
        self.assertEqual(
            traces["items"]["properties"]["ref"]["enum"],
            ["HLR-001", "HLR-002"],
        )

    def test_trace_ref_enum_union_of_all_targets(self) -> None:
        """When both HLR and LLR ids are available the ref enum contains
        the sorted union — a Test tracing directly to an HLR will still
        render its ref value in the select widget."""
        refs = {"HLR": ["HLR-001", "HLR-002"], "LLR": ["LLR-NAV-01", "LLR-NAV-02"]}
        out = derive_form_schema("Test", refs=refs)
        traces = out["schema"]["properties"]["traces"]
        ref_enum = traces["items"]["properties"]["ref"]["enum"]
        # All ids appear in one merged, sorted list.
        self.assertEqual(
            ref_enum,
            ["HLR-001", "HLR-002", "LLR-NAV-01", "LLR-NAV-02"],
        )
        # An HLR id present in formData will match the enum → renders.
        self.assertIn("HLR-001", ref_enum)

    def test_trace_ref_no_enum_when_refs_empty(self) -> None:
        """With no refs snapshot the ref field is free-text (no enum)."""
        out = derive_form_schema("Test", refs={})
        traces = out["schema"]["properties"]["traces"]
        self.assertNotIn("enum", traces["items"]["properties"]["ref"])


class CascadeIdRenameTests(WorkspaceMixin, unittest.TestCase):
    """Verify that renaming an LLR or HLR id cascades to traces."""

    def test_rename_llr_cascades_to_test_traces(self) -> None:
        """Renaming an LLR id should update <trace ref=...> in tests."""
        result = apply_edit(
            [{"op": "replace",
              "path": "/llrs/function[number=1]/llr[id=LLR-CORE-01]/@id",
              "value": "LLR-CORE-99"}],
            xml_path=str(self.xml_path),
        )
        self.assertTrue(result.ok, result.findings.get("errors"))
        # Verify the test trace was updated on disk.
        from lxml import etree
        tree = etree.parse(str(self.xml_path))
        traces = tree.xpath("//trace[@target='LLR']")
        refs = [t.get("ref") for t in traces]
        self.assertIn("LLR-CORE-99", refs)
        self.assertNotIn("LLR-CORE-01", refs)

    def test_rename_hlr_cascades_to_llr_and_test_traces(self) -> None:
        """Renaming an HLR id should update traces in LLRs and tests."""
        result = apply_edit(
            [{"op": "replace",
              "path": "/hlrs/section[number=1]/hlr[id=HLR-001]/@id",
              "value": "HLR-099"}],
            xml_path=str(self.xml_path),
        )
        self.assertTrue(result.ok, result.findings.get("errors"))
        from lxml import etree
        tree = etree.parse(str(self.xml_path))
        traces = tree.xpath("//trace[@target='HLR']")
        refs = [t.get("ref") for t in traces]
        self.assertIn("HLR-099", refs)
        self.assertNotIn("HLR-001", refs)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
