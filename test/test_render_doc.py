"""Tests for the importable surface of tools/render_doc.py."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401  (sys.path side-effect)

import render_doc
from render_doc import (
    ProjectXmlError,
    init_project,
    load_project,
    parse_project_to_dict,
    render_document,
)


class InitProjectTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.xml_path = self.tmp / "Project.xml"
        self.pvd_path = self.tmp / "PVD.md"

    def test_creates_xml_and_pvd(self) -> None:
        result = init_project(
            name="TestProj",
            short_name="tp",
            author="Alice",
            xml_path=self.xml_path,
            pvd_path=self.pvd_path,
        )
        self.assertEqual(result["xml_path"], str(self.xml_path))
        self.assertEqual(result["pvd_path"], str(self.pvd_path))
        self.assertEqual(result["existing"], [])
        self.assertTrue(self.xml_path.exists())
        self.assertTrue(self.pvd_path.exists())
        text = self.xml_path.read_text()
        self.assertIn('name="TestProj"', text)
        self.assertIn('short_name="tp"', text)
        self.assertIn("Alice", text)
        # PVD placeholder substitution.
        pvd = self.pvd_path.read_text()
        self.assertIn("TestProj", pvd)
        self.assertNotIn("<Product Name>", pvd)

    def test_refuses_overwrite_without_force(self) -> None:
        init_project(
            name="A", short_name="a",
            xml_path=self.xml_path, pvd_path=self.pvd_path,
        )
        with self.assertRaises(ProjectXmlError) as cm:
            init_project(
                name="B", short_name="b",
                xml_path=self.xml_path, pvd_path=self.pvd_path,
            )
        self.assertIn("refusing to overwrite", str(cm.exception))

    def test_force_overwrites_existing(self) -> None:
        init_project(
            name="A", short_name="a",
            xml_path=self.xml_path, pvd_path=self.pvd_path,
        )
        result = init_project(
            name="B", short_name="b",
            xml_path=self.xml_path, pvd_path=self.pvd_path,
            force=True,
        )
        self.assertEqual(
            sorted(result["existing"]),
            sorted([str(self.xml_path), str(self.pvd_path)]),
        )
        self.assertIn('name="B"', self.xml_path.read_text())

    def test_does_not_write_to_stderr(self) -> None:
        # init_project is a library function: callers control output.
        import io
        import contextlib

        buf_err = io.StringIO()
        buf_out = io.StringIO()
        with contextlib.redirect_stderr(buf_err), contextlib.redirect_stdout(buf_out):
            init_project(
                name="Q", short_name="q",
                xml_path=self.xml_path, pvd_path=self.pvd_path,
            )
        self.assertEqual(buf_err.getvalue(), "")
        self.assertEqual(buf_out.getvalue(), "")


class LoadProjectTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.xml_path = self.tmp / "Project.xml"
        self.pvd_path = self.tmp / "PVD.md"
        init_project(
            name="LP", short_name="lp", author="Bob",
            xml_path=self.xml_path, pvd_path=self.pvd_path,
        )

    def test_load_known_metadata_id(self) -> None:
        project = load_project(self.xml_path, "SDD")
        self.assertEqual(project.name, "LP")
        self.assertEqual(project.short_name, "lp")
        self.assertEqual(project.metadata.id, "SDD")

    def test_load_unknown_metadata_id_raises_project_xml_error(self) -> None:
        with self.assertRaises(ProjectXmlError):
            load_project(self.xml_path, "NoSuchDoc")

    def test_missing_file_raises_project_xml_error(self) -> None:
        with self.assertRaises(ProjectXmlError):
            load_project(self.tmp / "nope.xml", "SDD")

    def test_malformed_xml_raises_project_xml_error(self) -> None:
        bad = self.tmp / "bad.xml"
        bad.write_text("<project><unclosed>")
        with self.assertRaises(ProjectXmlError):
            load_project(bad, "SDD")


class ParseProjectToDictTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.xml_path = self.tmp / "Project.xml"
        init_project(
            name="PJ", short_name="pj",
            xml_path=self.xml_path,
            pvd_path=self.tmp / "PVD.md",
        )

    def test_returns_jsonable_dict(self) -> None:
        import json

        data = parse_project_to_dict(self.xml_path)
        self.assertIsInstance(data, dict)
        self.assertEqual(data["name"], "PJ")
        self.assertEqual(data["short_name"], "pj")
        # No SimpleNamespace should remain — must round-trip JSON.
        json.dumps(data)

    def test_default_metadata_for_first_document(self) -> None:
        data = parse_project_to_dict(self.xml_path)
        # The skeleton defines SDD as the first <document>.
        self.assertEqual(data["metadata"]["id"], "SDD")

    def test_explicit_metadata_for_overrides(self) -> None:
        data = parse_project_to_dict(self.xml_path, metadata_for="HLRs")
        self.assertEqual(data["metadata"]["id"], "HLRs")


class RenderDocumentTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.xml_path = self.tmp / "Project.xml"
        init_project(
            name="RD", short_name="rd", author="Dev",
            xml_path=self.xml_path,
            pvd_path=self.tmp / "PVD.md",
        )

    def test_render_hlrs_returns_markdown_with_single_trailing_newline(self) -> None:
        template = _paths.TEMPLATES_DIR / "HLRs.md.j2"
        out = render_document(template, "HLRs", self.xml_path)
        self.assertIsInstance(out, str)
        self.assertTrue(out.endswith("\n"))
        self.assertFalse(out.endswith("\n\n"))
        self.assertIn("High-Level Requirements", out)

    def test_missing_template_raises_project_xml_error(self) -> None:
        with self.assertRaises(ProjectXmlError):
            render_document(self.tmp / "nope.j2", "HLRs", self.xml_path)


class InitProjectSchemaLocationTests(unittest.TestCase):
    """Verifies LLR-INI-04: the bootstrap writes a relative
    xsi:noNamespaceSchemaLocation pointing at tools/project.xsd."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)

    def test_writes_relative_schema_location_when_unset(self) -> None:
        # LLR-INI-04: when schema_location is not supplied, init_project
        # computes a relative path (never absolute) from the new
        # Project.xml's parent directory to the canonical project.xsd.
        import re
        xml_path = self.tmp / "doc" / "Project.xml"
        init_project(
            name="P", short_name="p",
            xml_path=xml_path,
            pvd_path=self.tmp / "doc" / "PVD.md",
        )
        text = xml_path.read_text()
        match = re.search(
            r'xsi:noNamespaceSchemaLocation="([^"]+)"', text,
        )
        self.assertIsNotNone(match, msg=f"no xsi:noNamespaceSchemaLocation found in:\n{text[:400]}")
        loc = match.group(1)
        self.assertFalse(
            loc.startswith("/"),
            msg=f"schema_location should be relative, got absolute: {loc!r}",
        )
        self.assertTrue(
            loc.endswith("project.xsd"),
            msg=f"schema_location should resolve to project.xsd, got: {loc!r}",
        )

    def test_explicit_schema_location_overrides_default(self) -> None:
        xml_path = self.tmp / "Project.xml"
        init_project(
            name="P", short_name="p",
            xml_path=xml_path,
            pvd_path=self.tmp / "PVD.md",
            schema_location="schemas/custom.xsd",
        )
        self.assertIn(
            'xsi:noNamespaceSchemaLocation="schemas/custom.xsd"',
            xml_path.read_text(),
        )


class RenderDataSurfaceTests(unittest.TestCase):
    """Verifies LLR-RND-04: the gh_slug filter and the project.*
    cross-reference indexes are exposed to every render."""

    def test_rendered_document_uses_gh_slug_anchor(self) -> None:
        # The HLRs template emits anchors that gh_slug() produces.
        # Prove the filter is wired by rendering a document whose
        # template depends on it: HLRs.md emits "<a id=...></a>" tags
        # whose ids are gh_slug-derived from the section titles.
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp))
        xml_path = tmp / "Project.xml"
        init_project(
            name="GS", short_name="gs",
            xml_path=xml_path,
            pvd_path=tmp / "PVD.md",
        )
        out = render_document(
            _paths.TEMPLATES_DIR / "HLRs.md.j2", "HLRs", xml_path,
        )
        # The template depends on the gh_slug filter for anchor ids.
        # If the filter were missing, the render would have raised a
        # jinja2 TemplateAssertionError before producing this output.
        self.assertIn("High-Level Requirements", out)

    def test_gh_slug_filter_is_registered_on_jinja_env(self) -> None:
        # The render hot path builds the env inside render() and
        # registers gh_slug there. Cover it by rendering against a
        # one-shot template that invokes the filter; if it were not
        # registered the render would raise.
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp))
        xml_path = tmp / "Project.xml"
        init_project(
            name="GS", short_name="gs",
            xml_path=xml_path,
            pvd_path=tmp / "PVD.md",
        )
        tpl = tmp / "probe.j2"
        tpl.write_text("slug={{ 'Section 3.2.1' | gh_slug }}\n")
        out = render_document(tpl, "SDD", xml_path)
        self.assertEqual(out, "slug=section-321\n")
        # Sanity-check the filter implementation directly too.
        self.assertEqual(render_doc._gh_slug("Section 3.2.1"), "section-321")


class ListDocumentsTests(unittest.TestCase):
    """Phase 2.5 schema-driven discovery surface."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)

    def test_list_documents_returns_one_entry_per_metadata_document(self) -> None:
        # LLR-MET-02: list_documents enumerates every <metadata>
        # <document> entry verbatim and resolves the conventional
        # template/output paths when the optional attrs are absent.
        xml_path = self.tmp / "Project.xml"
        init_project(name="LD", short_name="ld", xml_path=xml_path,
                     pvd_path=self.tmp / "PVD.md")
        docs = render_doc.list_documents(xml_path)
        ids = [d["id"] for d in docs]
        self.assertEqual(
            ids, ["SDD", "HLRs", "LLRs", "STP", "Traceability"],
            msg=f"unexpected ids: {ids}",
        )
        sdd = next(d for d in docs if d["id"] == "SDD")
        self.assertEqual(sdd["template"], "tools/templates/SDD.md.j2")
        self.assertEqual(sdd["output"], "doc/SDD.md")

    def test_list_documents_honours_explicit_template_and_output(self) -> None:
        # LLR-MET-01: the optional template= and output= attributes
        # on <metadata><document> override the conventional paths;
        # list_documents returns whatever the file declares.
        xml_path = self.tmp / "Project.xml"
        xml_path.write_text(
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<project name="X" short_name="x" schema_version="1.2">'
            '<metadata>'
            '<document id="Plan" title="P" source="doc/Plan.md"'
            '          version="0.1" date="2026-04-25" author="A"'
            '          template="custom/Plan.j2" output="out/Plan.md"/>'
            '</metadata>'
            '</project>'
        )
        docs = render_doc.list_documents(xml_path)
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0]["template"], "custom/Plan.j2")
        self.assertEqual(docs[0]["output"], "out/Plan.md")


class UiHintsTests(unittest.TestCase):
    """Phase 2.5b UI hint registry (urn:tracer:ui:v1).

    Pins LLR-HNT-04: ui:icon / ui:color / ui:group attributes on
    <hlr>, <llr>, <test>, and <module> elements survive parsing and
    surface as a `ui` dict on every JSON-RPC parsed payload. Absent
    hints serialise as None so consumers can discriminate cheaply.
    """

    def _write_project_with_hint(self, tmp: Path) -> Path:
        xml_path = tmp / "Project.xml"
        xml_path.write_text(
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<project name="UH" short_name="uh" schema_version="1.3"'
            '         xmlns:ui="urn:tracer:ui:v1">'
            '<metadata>'
            '<document id="HLRs" title="H" source="doc/HLRs.md"'
            '          version="0.1" date="2026-04-25" author="A"/>'
            '</metadata>'
            '<hlrs>'
            '<section number="1" title="Core">'
            '<hlr id="HLR-001" name="Decorated"'
            '     ui:icon="star" ui:color="charts.blue">'
            '<text>x</text></hlr>'
            '<hlr id="HLR-002" name="Plain"><text>y</text></hlr>'
            '</section>'
            '</hlrs>'
            '<llrs>'
            '<function number="1" title="F" name="f">'
            '<llr id="LLR-FN-01" ui:icon="rocket"><text>z</text></llr>'
            '</function>'
            '</llrs>'
            '<tests>'
            '<file path="t/x.py">'
            '<test name="test_x" ui:icon="beaker" ui:group="smoke"/>'
            '</file>'
            '</tests>'
            '</project>'
        )
        return xml_path

    def test_ui_hints_surface_on_parsed_hlr(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp))
        xml_path = self._write_project_with_hint(tmp)
        data = render_doc.parse_project_to_dict(xml_path, metadata_for="HLRs")
        flat = data["flat_hlrs"]
        decorated = next(h for h in flat if h["id"] == "HLR-001")
        plain = next(h for h in flat if h["id"] == "HLR-002")
        self.assertEqual(
            decorated["ui"], {"icon": "star", "color": "charts.blue"}
        )
        self.assertIsNone(plain["ui"])

    def test_ui_hints_surface_on_parsed_llr_and_test(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp))
        xml_path = self._write_project_with_hint(tmp)
        data = render_doc.parse_project_to_dict(xml_path, metadata_for="HLRs")
        llr = data["flat_llrs"][0]
        self.assertEqual(llr["id"], "LLR-FN-01")
        self.assertEqual(llr["ui"], {"icon": "rocket"})
        # Tests preserve the reserved `group` key verbatim — the TS
        # consumer ignores it today but the data contract carries it.
        test = data["flat_tests"][0]
        self.assertEqual(test["name"], "test_x")
        self.assertEqual(test["ui"], {"icon": "beaker", "group": "smoke"})

    def test_xsd_accepts_ui_namespace_attributes_on_payload_elements(self) -> None:
        # LLR-HNT-01: project.xsd declares xs:anyAttribute namespace=
        # "urn:tracer:ui:v1" processContents="skip" on Hlr/Llr/Test/
        # SddModule, so a project with ui:icon / ui:color / ui:group
        # on those elements must validate clean against the XSD.
        # We exercise the lxml validation path directly so the test
        # passes regardless of whether xmllint is installed.
        try:
            import lxml.etree as LET  # type: ignore
        except ImportError:  # pragma: no cover - environment guard
            self.skipTest("lxml not available")
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp))
        xml_path = self._write_project_with_hint(tmp)
        xsd_path = Path(_paths.TOOLS_DIR) / "project.xsd"
        schema = LET.XMLSchema(LET.parse(str(xsd_path)))
        # assertValid raises DocumentInvalid on failure; reaching the
        # next line means the file passed schema validation.
        schema.assertValid(LET.parse(str(xml_path)))


class CliSedEditTests(unittest.TestCase):
    """HLR-041: no runtime service dependency — a plain CLI text tool
    (sed) can modify Project.xml; render and lint use only local files."""

    def setUp(self) -> None:
        import shutil
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.xml_path = self.tmp / "Project.xml"
        self.pvd_path = self.tmp / "PVD.md"
        init_project(
            name="SedTest", short_name="st", author="Tester",
            xml_path=self.xml_path, pvd_path=self.pvd_path,
        )
        # Copy templates so render_document can find them.
        dst = self.tmp / "templates"
        shutil.copytree(_paths.TEMPLATES_DIR, dst)

    def test_cli_sed_edit_no_runtime_service(self) -> None:
        import subprocess
        from lint_project import lint

        # 1. Verify the freshly-init'd file has project name "SedTest".
        original = self.xml_path.read_text()
        self.assertIn('name="SedTest"', original)

        # 2. Use sed (a plain CLI text tool) to rename the project.
        result = subprocess.run(
            ["sed", "-i", 's/name="SedTest"/name="SedEdited"/', str(self.xml_path)],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, f"sed failed: {result.stderr}")

        # 3. Confirm the edit took effect in the plain-text file.
        edited = self.xml_path.read_text()
        self.assertIn('name="SedEdited"', edited)
        self.assertNotIn('name="SedTest"', edited)

        # 4. Parse and render the sed-edited file — no service needed.
        parsed = parse_project_to_dict(self.xml_path)
        self.assertEqual(parsed["name"], "SedEdited")
        md = render_document(
            self.tmp / "templates" / "HLRs.md.j2",
            metadata_id="HLRs",
            xml_path=self.xml_path,
        )
        self.assertIsInstance(md, str)
        self.assertTrue(len(md) > 0)

        # 5. Lint the sed-edited file — only local XSD, no network.
        findings = lint(self.xml_path, _paths.PROJECT_XSD)
        self.assertEqual(len(findings.errors), 0,
                         f"Unexpected errors: {findings.errors}")


if __name__ == "__main__":
    unittest.main()
