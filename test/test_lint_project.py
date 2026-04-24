"""Tests for the importable surface of tools/lint_project.py."""
from __future__ import annotations

import io
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401  (sys.path side-effect)

from lint_project import Findings, lint
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
        self.assertEqual(set(d.keys()), {"errors", "warnings", "notes"})
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


if __name__ == "__main__":
    unittest.main()
