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


if __name__ == "__main__":
    unittest.main()
