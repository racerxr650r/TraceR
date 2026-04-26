"""Phase 2.5c acceptance test: each `Finding.code` Quick Fix.

Mirrors the SDP §8 Phase 2.5c acceptance bar:

    "Triggering each `Finding.code` value on the `<plan>` fixture
    surfaces the correct Quick Fix without any payload-specific code
    path; applying the fix produces a clean re-lint."

Strategy:

1.  Start from ``test/doc/Project.xml`` (which lints cleanly today and
    carries the `<plan>` payload).
2.  For each of the four codes shipped in Phase 2.5
    (``broken-trace`` / ``id-format`` / ``missing-template`` /
    ``no-test``), apply a minimal mutation that triggers exactly that
    finding.
3.  Confirm the linter emits the targeted ``Finding.code``.
4.  Apply the Quick Fix as a text edit that mirrors what the TypeScript
    ``QuickFixProvider`` (and its companion command in
    ``tools/vscode-project-xml/src/commands/quickFixes.ts``) would do
    against the same diagnostic.
5.  Re-lint and assert the targeted ``Finding.code`` is gone *and* no
    other errors or warnings have been introduced. ("Produces a clean
    re-lint.")

The mutations and fixes here are deliberately payload-agnostic — they
operate on HLRs, LLRs, and tests but the fix logic only consults the
``Finding.code`` value, exactly as the TypeScript provider does.
"""
from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401 — sys.path side effect

import lint_project
from lint_project import lint

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_XML = REPO_ROOT / "test" / "doc" / "Project.xml"
PROJECT_XSD = REPO_ROOT / "tools" / "project.xsd"


def _has_code(items, code: str) -> bool:
    return any(item.code == code for item in items)


def _codes(items) -> list[str]:
    return sorted({item.code for item in items if item.code})


class QuickFixAcceptanceTests(unittest.TestCase):
    """One test per Finding.code: trigger → lint → fix → re-lint."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        # Mirror the relative layout the fixture relies on so the
        # `xsi:noNamespaceSchemaLocation="../../tools/project.xsd"`
        # hint resolves.
        (self.tmp / "test" / "doc").mkdir(parents=True)
        (self.tmp / "tools" / "templates").mkdir(parents=True)
        # Copy every template the fixture's <document> rows reference.
        for tpl in (REPO_ROOT / "tools" / "templates").iterdir():
            shutil.copy(tpl, self.tmp / "tools" / "templates" / tpl.name)
        shutil.copy(PROJECT_XSD, self.tmp / "tools" / "project.xsd")
        self.xml_path = self.tmp / "test" / "doc" / "Project.xml"
        shutil.copy(FIXTURE_XML, self.xml_path)
        # Point lint_project at our isolated workspace root so the
        # `<metadata><document template="...">` existence check resolves
        # template paths under self.tmp (where the Quick Fix would
        # create the file) instead of the real repo.
        self._original_repo_root = lint_project.REPO_ROOT
        lint_project.REPO_ROOT = self.tmp
        self.addCleanup(self._restore_repo_root)
        # Sanity: baseline fixture lints cleanly so any new findings
        # we observe are caused by our mutations alone.
        baseline = lint(self.xml_path, self.tmp / "tools" / "project.xsd")
        self.assertEqual(baseline.errors, [], baseline.errors)
        self.assertEqual(baseline.warnings, [], baseline.warnings)

    # ------------------------------------------------------------------
    # broken-trace
    # ------------------------------------------------------------------

    def test_broken_trace_quick_fix_clears_finding(self) -> None:
        # Insert one HLR (HLR-001), one LLR that traces to a *non-
        # existent* HLR-999, and a test that covers both so no-test
        # warnings stay off.
        self._inject_hlrs("""
          <section number="1" title="Demo">
            <hlr id="HLR-001" name="alpha"><text>alpha</text></hlr>
          </section>
        """)
        self._inject_llrs("""
          <function number="1" title="t" name="demo" source="src/x.c">
            <llr id="LLR-DEMO-01">
              <text>broken</text>
              <traces>
                <trace target="HLR" ref="HLR-999"/>
              </traces>
            </llr>
          </function>
        """)
        self._inject_tests("""
          <file path="test/test_demo.py" role="unit" count="1">
            <test name="test_demo">
              <purpose>Cover HLR-001 and LLR-DEMO-01.</purpose>
              <traces>
                <trace target="HLR" ref="HLR-001"/>
                <trace target="LLR" ref="LLR-DEMO-01"/>
              </traces>
            </test>
          </file>
        """)
        before = lint(self.xml_path, self.tmp / "tools" / "project.xsd")
        self.assertTrue(
            _has_code(before.items, "broken-trace"),
            f"expected broken-trace, got codes={_codes(before.items)}",
        )

        # Quick Fix: replace the bad ref with a valid HLR id picked
        # from the parsed tree. The TS command does the same thing via
        # WorkspaceEdit.replace; here we mirror it as a text edit.
        self._replace('ref="HLR-999"', 'ref="HLR-001"')

        after = lint(self.xml_path, self.tmp / "tools" / "project.xsd")
        self.assertFalse(_has_code(after.items, "broken-trace"))
        self.assertEqual(after.errors, [])
        self.assertEqual(after.warnings, [])

    # ------------------------------------------------------------------
    # id-format
    # ------------------------------------------------------------------

    def test_id_format_quick_fix_clears_finding(self) -> None:
        self._inject_hlrs("""
          <section number="1" title="Demo">
            <hlr id="HLR-1" name="alpha"><text>alpha</text></hlr>
          </section>
        """)
        self._inject_tests("""
          <file path="test/test_demo.py" role="unit" count="1">
            <test name="test_demo">
              <purpose>Cover HLR-1.</purpose>
              <traces>
                <trace target="HLR" ref="HLR-1"/>
              </traces>
            </test>
          </file>
        """)
        before = lint(self.xml_path, self.tmp / "tools" / "project.xsd")
        self.assertTrue(_has_code(before.items, "id-format"))

        # Quick Fix: renumber as the next free HLR-NNN. With no other
        # HLRs in the tree, that's HLR-001.
        self._replace('id="HLR-1"', 'id="HLR-001"')
        self._replace('ref="HLR-1"', 'ref="HLR-001"')

        after = lint(self.xml_path, self.tmp / "tools" / "project.xsd")
        self.assertFalse(_has_code(after.items, "id-format"))
        self.assertEqual(after.errors, [])
        self.assertEqual(after.warnings, [])

    # ------------------------------------------------------------------
    # missing-template
    # ------------------------------------------------------------------

    def test_missing_template_quick_fix_clears_finding(self) -> None:
        # Add a <document> entry whose template file is intentionally
        # absent. The TS Quick Fix would create the file via
        # WorkspaceEdit.createFile + insert.
        self._inject_metadata_document(
            '<document id="Stub" title="Stub" source="doc/Stub.md" '
            'version="0.1" date="2026-04-25" author="t" '
            'template="tools/templates/Stub.md.j2" output="doc/Stub.md"/>'
        )
        before = lint(self.xml_path, self.tmp / "tools" / "project.xsd")
        self.assertTrue(_has_code(before.items, "missing-template"))

        # Quick Fix: stub the missing template.
        target = self.tmp / "tools" / "templates" / "Stub.md.j2"
        target.write_text("# Stub\n\nGenerated stub for Stub.\n")

        after = lint(self.xml_path, self.tmp / "tools" / "project.xsd")
        self.assertFalse(_has_code(after.items, "missing-template"))
        self.assertEqual(after.errors, [])
        self.assertEqual(after.warnings, [])

    # ------------------------------------------------------------------
    # no-test
    # ------------------------------------------------------------------

    def test_no_test_quick_fix_clears_finding(self) -> None:
        # Add an HLR with no test verifying it.
        self._inject_hlrs("""
          <section number="1" title="Demo">
            <hlr id="HLR-001" name="alpha"><text>alpha</text></hlr>
          </section>
        """)
        before = lint(self.xml_path, self.tmp / "tools" / "project.xsd")
        self.assertTrue(_has_code(before.items, "no-test"))

        # Quick Fix: append a stub <file><test><traces> block before
        # </tests>. Mirrors stubTestFragment() in fixes.ts.
        fragment = (
            '  <file path="test/test_hlr_stubs.py" role="unit" count="1">\n'
            '    <test name="test_hlr_001_stub">\n'
            '      <purpose>Stub test verifying HLR-001.</purpose>\n'
            '      <traces>\n'
            '        <trace target="HLR" ref="HLR-001"/>\n'
            '      </traces>\n'
            '    </test>\n'
            '  </file>\n  '
        )
        self._replace("</tests>", fragment + "</tests>")

        after = lint(self.xml_path, self.tmp / "tools" / "project.xsd")
        self.assertFalse(
            _has_code(after.items, "no-test"),
            f"residual codes: {_codes(after.items)}",
        )
        self.assertEqual(after.errors, [])
        self.assertEqual(after.warnings, [])

    # ------------------------------------------------------------------
    # mutation helpers — operate on the on-disk XML as plain text so
    # they mirror exactly what a vscode.WorkspaceEdit would produce.
    # ------------------------------------------------------------------

    def _restore_repo_root(self) -> None:
        lint_project.REPO_ROOT = self._original_repo_root

    def _replace(self, needle: str, replacement: str) -> None:
        text = self.xml_path.read_text()
        self.assertIn(needle, text, f"needle not present: {needle!r}")
        self.xml_path.write_text(text.replace(needle, replacement, 1))

    def _inject_hlrs(self, body: str) -> None:
        self._replace("<hlrs>\n  </hlrs>", f"<hlrs>{body}  </hlrs>")

    def _inject_llrs(self, body: str) -> None:
        self._replace("<llrs>\n  </llrs>", f"<llrs>{body}  </llrs>")

    def _inject_tests(self, body: str) -> None:
        self._replace("<tests>\n  </tests>", f"<tests>{body}  </tests>")

    def _inject_metadata_document(self, doc_xml: str) -> None:
        self._replace("<counts>", f"{doc_xml}\n    <counts>")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
