"""Tests for the importable surface of tools/lint_project.py."""
from __future__ import annotations

import io
import tempfile
import unittest
import unittest.mock as mock
import xml.etree.ElementTree as ET
from pathlib import Path

import _paths  # noqa: F401  (sys.path side-effect)

import lint_project
from lint_project import Findings, check_semantics, lint, validate_structure
from render_doc import init_project


class LintLibraryTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.xml_path = self.tmp / "Project.xml"
        init_project(
            name="L", short_name="l",
            xml_path=self.xml_path,
            pvd_path=self.tmp / "PVD.md",
        )

    def test_lint_returns_findings_object(self) -> None:
        findings = lint(self.xml_path, _paths.PROJECT_XSD)
        self.assertIsInstance(findings, Findings)

    def test_findings_to_dict_is_jsonable(self) -> None:
        import json

        findings = lint(self.xml_path, _paths.PROJECT_XSD)
        d = findings.to_dict()
        self.assertEqual(
            set(d.keys()), {"errors", "warnings", "notes", "items"}
        )
        for v in d.values():
            self.assertIsInstance(v, list)
        json.dumps(d)

    def test_skeleton_has_no_errors(self) -> None:
        # A freshly initialised Project.xml has empty payloads; warnings
        # are acceptable but there must be no errors.
        findings = lint(self.xml_path, _paths.PROJECT_XSD)
        self.assertEqual(findings.errors, [])

    def test_missing_file_records_error_no_stderr(self) -> None:
        import contextlib

        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            findings = lint(self.tmp / "nope.xml", _paths.PROJECT_XSD)
        self.assertEqual(buf.getvalue(), "")
        self.assertTrue(findings.errors)
        self.assertIn("file not found", findings.errors[0])

    def test_malformed_xml_records_error(self) -> None:
        bad = self.tmp / "bad.xml"
        bad.write_text("<project><unclosed>")
        findings = lint(bad, _paths.PROJECT_XSD)
        self.assertTrue(findings.errors)

    def test_real_repo_project_xml_lints(self) -> None:
        # Smoke test against the actual repo Project.xml; it must at
        # least not produce any lint *errors* (warnings are allowed).
        if not _paths.DOC_PROJECT_XML.exists():
            self.skipTest("doc/Project.xml not present")
        findings = lint(_paths.DOC_PROJECT_XML, _paths.PROJECT_XSD)
        self.assertEqual(findings.errors, [], msg=findings.errors)


class FindingsReportTests(unittest.TestCase):
    def test_report_writes_to_supplied_stream(self) -> None:
        f = Findings()
        f.error("oops")
        f.warn("hmm")
        f.note("fyi")
        buf = io.StringIO()
        f.report(show_warnings=True, stream=buf)
        out = buf.getvalue()
        self.assertIn("oops", out)
        self.assertIn("hmm", out)
        self.assertIn("fyi", out)
        self.assertIn("1 error(s)", out)

    def test_report_suppresses_warnings_when_disabled(self) -> None:
        f = Findings()
        f.warn("hidden")
        buf = io.StringIO()
        f.report(show_warnings=False, stream=buf)
        self.assertNotIn("hidden", buf.getvalue())


class ValidateStructureTests(unittest.TestCase):
    """Verifies the lxml -> xmllint -> structural-only fallback chain
    documented in LLR-VST-01..04."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.xml_path = self.tmp / "Project.xml"
        init_project(
            name="V", short_name="v",
            xml_path=self.xml_path,
            pvd_path=self.tmp / "PVD.md",
        )

    def test_malformed_xml_records_error_and_returns_none(self) -> None:
        # LLR-VST-01: structural validation runs first; malformed XML
        # short-circuits before any validator is reached.
        bad = self.tmp / "bad.xml"
        bad.write_text("<project><unclosed>")
        f = Findings()
        tree = validate_structure(bad, _paths.PROJECT_XSD, f)
        self.assertIsNone(tree)
        self.assertTrue(f.errors)
        self.assertIn("malformed XML", f.errors[0])

    def test_lxml_path_is_preferred_when_available(self) -> None:
        # LLR-VST-01: when _try_lxml_validate returns True, xmllint is
        # not consulted and no degraded-mode note is emitted.
        f = Findings()
        with mock.patch.object(lint_project, "_try_lxml_validate", return_value=True) as lx, \
             mock.patch.object(lint_project, "_try_xmllint_validate", return_value=True) as xl:
            tree = validate_structure(self.xml_path, _paths.PROJECT_XSD, f)
        self.assertIsNotNone(tree)
        lx.assert_called_once()
        xl.assert_not_called()
        self.assertEqual(f.notes, [])

    def test_xmllint_fallback_when_lxml_unavailable(self) -> None:
        # LLR-VST-02: when lxml says "not available" (returns False),
        # xmllint is consulted next.
        f = Findings()
        with mock.patch.object(lint_project, "_try_lxml_validate", return_value=False) as lx, \
             mock.patch.object(lint_project, "_try_xmllint_validate", return_value=True) as xl:
            tree = validate_structure(self.xml_path, _paths.PROJECT_XSD, f)
        self.assertIsNotNone(tree)
        lx.assert_called_once()
        xl.assert_called_once()
        self.assertEqual(f.notes, [])

    def test_structural_only_emits_explicit_note(self) -> None:
        # LLR-VST-03: when neither validator is available, parse the
        # document for well-formedness and record an explicit note that
        # XSD validation was skipped.
        f = Findings()
        with mock.patch.object(lint_project, "_try_lxml_validate", return_value=False), \
             mock.patch.object(lint_project, "_try_xmllint_validate", return_value=False):
            tree = validate_structure(self.xml_path, _paths.PROJECT_XSD, f)
        self.assertIsNotNone(tree)
        self.assertEqual(f.errors, [])
        self.assertEqual(len(f.notes), 1)
        self.assertIn("XSD validation skipped", f.notes[0])


def _parse_xml(text: str) -> ET.ElementTree:
    return ET.ElementTree(ET.fromstring(text))


def _wrap_project(body: str) -> str:
    return (
        '<project name="X" short_name="x" schema_version="1.1">'
        '<metadata>'
        '<document id="SDD" title="" source="SDD.md"/>'
        '<document id="HLRs" title="" source="HLRs.md"/>'
        '<document id="LLRs" title="" source="LLRs.md"/>'
        '<document id="STP" title="" source="STP.md"/>'
        '<document id="Traceability" title="" source="Traceability.md"/>'
        '</metadata>'
        f'{body}'
        '</project>'
    )


class CheckSemanticsTests(unittest.TestCase):
    """Verifies the semantic checks in LLR-SEM-01..06 by feeding
    handcrafted XML payloads to check_semantics() directly."""

    def test_bad_hlr_id_format_is_an_error(self) -> None:
        # LLR-SEM-01: HLR ids must match HLR-NNN.
        tree = _parse_xml(_wrap_project(
            '<hlrs><section number="1" title="t">'
            '<hlr id="HLR-bad" name="n"><text>shall</text></hlr>'
            '</section></hlrs>'
        ))
        f = Findings()
        check_semantics(tree, f)
        self.assertTrue(any("HLR-bad" in e and "HLR-NNN" in e for e in f.errors))

    def test_bad_llr_id_format_is_an_error(self) -> None:
        # LLR-SEM-01: LLR ids must match LLR-XXX-NN.
        tree = _parse_xml(_wrap_project(
            '<llrs><function number="1" title="t" name="n" source="s">'
            '<llr id="LLR-bad-1"><text>shall</text></llr>'
            '</function></llrs>'
        ))
        f = Findings()
        check_semantics(tree, f)
        self.assertTrue(any("LLR-bad-1" in e and "LLR-XXX-NN" in e for e in f.errors))

    def test_duplicate_hlr_id_is_an_error(self) -> None:
        # LLR-SEM-02: every duplicate HLR id is reported.
        tree = _parse_xml(_wrap_project(
            '<hlrs><section number="1" title="t">'
            '<hlr id="HLR-001" name="a"><text>shall</text></hlr>'
            '<hlr id="HLR-001" name="b"><text>shall</text></hlr>'
            '</section></hlrs>'
        ))
        f = Findings()
        check_semantics(tree, f)
        self.assertTrue(any("duplicate HLR id: HLR-001" in e for e in f.errors))

    def test_duplicate_llr_id_is_an_error(self) -> None:
        # LLR-SEM-02: every duplicate LLR id is reported.
        tree = _parse_xml(_wrap_project(
            '<llrs><function number="1" title="t" name="n" source="s">'
            '<llr id="LLR-AAA-01"><text>shall</text></llr>'
            '<llr id="LLR-AAA-01"><text>shall</text></llr>'
            '</function></llrs>'
        ))
        f = Findings()
        check_semantics(tree, f)
        self.assertTrue(any("duplicate LLR id: LLR-AAA-01" in e for e in f.errors))

    def test_unknown_hlr_trace_is_an_error(self) -> None:
        # LLR-SEM-03: an LLR that traces to a non-existent HLR ref
        # produces an error quoting the missing id.
        tree = _parse_xml(_wrap_project(
            '<llrs><function number="1" title="t" name="n" source="s">'
            '<llr id="LLR-AAA-01">'
            '<text>shall</text>'
            '<traces><trace target="HLR" ref="HLR-999"/></traces>'
            '</llr>'
            '</function></llrs>'
        ))
        f = Findings()
        check_semantics(tree, f)
        self.assertTrue(any("unknown HLR 'HLR-999'" in e for e in f.errors))

    def test_unknown_llr_trace_from_test_is_an_error(self) -> None:
        # LLR-SEM-03: a test that traces to a non-existent LLR ref
        # produces an error.
        tree = _parse_xml(_wrap_project(
            '<tests><file path="test/x.py" role="unit" count="1">'
            '<test name="test_x">'
            '<purpose>p</purpose>'
            '<traces><trace target="LLR" ref="LLR-NOPE-99"/></traces>'
            '</test>'
            '</file></tests>'
        ))
        f = Findings()
        check_semantics(tree, f)
        self.assertTrue(any("unknown LLR 'LLR-NOPE-99'" in e for e in f.errors))

    def test_non_dotted_sdd_ref_is_a_warning_not_an_error(self) -> None:
        # LLR-SEM-04: SDD refs that don't look like dotted section
        # numbers are warnings, not errors.
        tree = _parse_xml(_wrap_project(
            '<hlrs><section number="1" title="t">'
            '<hlr id="HLR-001" name="a">'
            '<text>shall</text>'
            '<traces><trace target="SDD" ref="not-a-section"/></traces>'
            '</hlr>'
            '</section></hlrs>'
        ))
        f = Findings()
        check_semantics(tree, f)
        self.assertEqual(f.errors, [])
        self.assertTrue(any("not-a-section" in w for w in f.warnings))

    def test_coverage_gap_for_uncovered_llr_is_a_warning(self) -> None:
        # LLR-SEM-05 / LLR-LNT-03: LLRs with no test produce one warning
        # per gap, never an error.
        tree = _parse_xml(_wrap_project(
            '<llrs><function number="1" title="t" name="n" source="s">'
            '<llr id="LLR-AAA-01"><text>shall</text></llr>'
            '</function></llrs>'
        ))
        f = Findings()
        check_semantics(tree, f)
        self.assertEqual(f.errors, [])
        self.assertTrue(any(
            w == "LLR LLR-AAA-01 has no test verifying it"
            for w in f.warnings
        ))

    def test_coverage_gap_for_uncovered_hlr_is_a_warning(self) -> None:
        # LLR-SEM-05: HLRs with no test (direct or via any LLR) warn.
        tree = _parse_xml(_wrap_project(
            '<hlrs><section number="1" title="t">'
            '<hlr id="HLR-001" name="a"><text>shall</text></hlr>'
            '</section></hlrs>'
        ))
        f = Findings()
        check_semantics(tree, f)
        self.assertTrue(any(
            "HLR HLR-001 has no test verifying it" in w
            for w in f.warnings
        ))

    def test_hlr_covered_indirectly_via_llr_test_is_not_a_gap(self) -> None:
        # LLR-SEM-05: an HLR is covered if any of its LLRs has a test.
        tree = _parse_xml(_wrap_project(
            '<hlrs><section number="1" title="t">'
            '<hlr id="HLR-001" name="a"><text>shall</text></hlr>'
            '</section></hlrs>'
            '<llrs><function number="1" title="t" name="n" source="s">'
            '<llr id="LLR-AAA-01">'
            '<text>shall</text>'
            '<traces><trace target="HLR" ref="HLR-001"/></traces>'
            '</llr>'
            '</function></llrs>'
            '<tests><file path="test/x.py" role="unit" count="1">'
            '<test name="test_x">'
            '<purpose>p</purpose>'
            '<traces><trace target="LLR" ref="LLR-AAA-01"/></traces>'
            '</test>'
            '</file></tests>'
        ))
        f = Findings()
        check_semantics(tree, f)
        self.assertFalse(
            any("HLR HLR-001" in w for w in f.warnings),
            msg=f"unexpected gap warning for HLR-001: {f.warnings}",
        )

    def test_missing_metadata_document_is_a_warning(self) -> None:
        # LLR-SEM-06 (Phase 2.5): a <metadata><document> declaration
        # whose template file is absent on disk produces a warning
        # naming the missing template path. The previous form of
        # this check warned on a fixed allow-list of "standard"
        # document ids; the schema-driven retrofit moved that
        # responsibility to the templates directory itself.
        bare = (
            '<project name="X" short_name="x" schema_version="1.1">'
            '<metadata>'
            '<document id="SDD" title="" source="SDD.md"/>'
            '<document id="NoSuchDoc" title="" source="NoSuchDoc.md"/>'
            '</metadata>'
            '</project>'
        )
        tree = _parse_xml(bare)
        f = Findings()
        check_semantics(tree, f)
        # SDD's conventional template exists in tools/templates/SDD.md.j2
        # so it should NOT trigger the warning; NoSuchDoc's does not
        # exist, so it should.
        self.assertFalse(
            any('id="SDD"' in w and 'missing template' in w for w in f.warnings),
            msg=f"unexpected missing-template warning for SDD: {f.warnings}",
        )
        self.assertTrue(
            any('id="NoSuchDoc"' in w and 'missing template' in w for w in f.warnings),
            msg=f"expected missing-template warning for NoSuchDoc: {f.warnings}",
        )

    def test_duplicate_metadata_document_is_an_error(self) -> None:
        # LLR-SEM-06: duplicate <document id="..."> entries are errors.
        tree = _parse_xml(
            '<project name="X" short_name="x" schema_version="1.1">'
            '<metadata>'
            '<document id="SDD" title="" source="SDD.md"/>'
            '<document id="SDD" title="" source="SDD.md"/>'
            '<document id="HLRs" title="" source="HLRs.md"/>'
            '<document id="LLRs" title="" source="LLRs.md"/>'
            '<document id="STP" title="" source="STP.md"/>'
            '<document id="Traceability" title="" source="Traceability.md"/>'
            '</metadata>'
            '</project>'
        )
        f = Findings()
        check_semantics(tree, f)
        self.assertTrue(any('duplicate <document id="SDD">' in e for e in f.errors))

    def test_mixed_prefix_warning_when_dominant_prefix_established(self) -> None:
        # LLR-SEM-07: warn when a function has a dominant prefix (≥4 LLRs)
        # alongside a minority prefix (≤2 LLRs).
        tree = _parse_xml(_wrap_project(
            '<llrs>'
            '<function number="1" title="t" name="fn">'
            '<llr id="LLR-ABC-01"><text>a</text></llr>'
            '<llr id="LLR-ABC-02"><text>a</text></llr>'
            '<llr id="LLR-ABC-03"><text>a</text></llr>'
            '<llr id="LLR-ABC-04"><text>a</text></llr>'
            '<llr id="LLR-XYZ-01"><text>a</text></llr>'
            '</function>'
            '</llrs>'
        ))
        f = Findings()
        check_semantics(tree, f)
        self.assertTrue(
            any("mixed" in w.lower() or "prefix" in w.lower() for w in f.warnings),
            msg=f"expected mixed-prefix warning, got: {f.warnings}",
        )


class SchemaUiNamespaceTests(unittest.TestCase):
    """Phase 2.5 namespace reservation."""

    def test_xsd_reserves_ui_namespace_prefix(self) -> None:
        # LLR-MET-05 / HLR-056: tools/project.xsd shall reserve the
        # urn:tracer:ui:v1 namespace under the `ui` prefix so a
        # future hint registry can attach UI-only attributes
        # without breaking existing files.
        from pathlib import Path
        xsd_text = Path(__file__).resolve().parent.parent.joinpath(
            "tools", "project.xsd"
        ).read_text(encoding="utf-8")
        self.assertIn('xmlns:ui="urn:tracer:ui:v1"', xsd_text)


if __name__ == "__main__":
    unittest.main()
