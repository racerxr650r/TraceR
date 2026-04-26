"""Tests for the JSON-RPC surface in tools/project_io.py.

Exercises both the in-process handle_request() entry point and the
end-to-end stdin/stdout subprocess form.
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401  (sys.path side-effect)

import project_io
from project_io import handle_request, serve
from render_doc import init_project


def _bootstrap_project(tmp: Path) -> Path:
    xml_path = tmp / "Project.xml"
    init_project(
        name="IO", short_name="io",
        xml_path=xml_path,
        pvd_path=tmp / "PVD.md",
    )
    return xml_path


class HandleRequestTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)

    def test_lint_method_returns_findings(self) -> None:
        xml_path = _bootstrap_project(self.tmp)
        resp = handle_request({
            "jsonrpc": "2.0", "id": 1, "method": "lint",
            "params": {
                "xml_path": str(xml_path),
                "xsd_path": str(_paths.PROJECT_XSD),
            },
        })
        self.assertIsNotNone(resp)
        self.assertEqual(resp["id"], 1)
        self.assertIn("result", resp)
        result = resp["result"]
        self.assertEqual(set(result.keys()),
                         {"errors", "warnings", "notes", "items", "ok"})
        self.assertTrue(result["ok"])

    def test_lint_matches_cli_findings(self) -> None:
        # Acceptance criterion from the plan: same findings as
        # tools/lint_project.py for the same Project.xml.
        if not _paths.DOC_PROJECT_XML.exists():
            self.skipTest("doc/Project.xml not present")
        from lint_project import lint as _lint_lib
        cli_findings = _lint_lib(_paths.DOC_PROJECT_XML, _paths.PROJECT_XSD)
        resp = handle_request({
            "id": 1, "method": "lint",
            "params": {
                "xml_path": str(_paths.DOC_PROJECT_XML),
                "xsd_path": str(_paths.PROJECT_XSD),
            },
        })
        self.assertEqual(resp["result"]["errors"], cli_findings.errors)
        self.assertEqual(resp["result"]["warnings"], cli_findings.warnings)
        self.assertEqual(resp["result"]["notes"], cli_findings.notes)

    def test_render_method_returns_markdown(self) -> None:
        xml_path = _bootstrap_project(self.tmp)
        template = _paths.TEMPLATES_DIR / "HLRs.md.j2"
        resp = handle_request({
            "id": 2, "method": "render",
            "params": {
                "template": str(template),
                "metadata_id": "HLRs",
                "xml_path": str(xml_path),
            },
        })
        self.assertIn("result", resp)
        self.assertIn("High-Level Requirements", resp["result"]["output"])
        self.assertTrue(resp["result"]["output"].endswith("\n"))
        self.assertIsNone(resp["result"]["out_path"])

    def test_render_writes_to_out_path(self) -> None:
        xml_path = _bootstrap_project(self.tmp)
        template = _paths.TEMPLATES_DIR / "HLRs.md.j2"
        out_path = self.tmp / "HLRs.md"
        resp = handle_request({
            "id": 3, "method": "render",
            "params": {
                "template": str(template),
                "metadata_id": "HLRs",
                "xml_path": str(xml_path),
                "out": str(out_path),
            },
        })
        self.assertIn("result", resp)
        self.assertEqual(resp["result"]["out_path"], str(out_path))
        self.assertTrue(out_path.exists())
        self.assertIn("High-Level Requirements", out_path.read_text())

    def test_parse_to_json_returns_dict(self) -> None:
        xml_path = _bootstrap_project(self.tmp)
        resp = handle_request({
            "id": 4, "method": "parse_to_json",
            "params": {"xml_path": str(xml_path)},
        })
        self.assertIn("result", resp)
        self.assertEqual(resp["result"]["name"], "IO")
        # Response must be JSON-serialisable.
        json.dumps(resp)

    def test_init_project_method(self) -> None:
        xml_path = self.tmp / "new" / "Project.xml"
        pvd_path = self.tmp / "new" / "PVD.md"
        resp = handle_request({
            "id": 5, "method": "init_project",
            "params": {
                "name": "NewProj",
                "short_name": "np",
                "xml_path": str(xml_path),
                "pvd_path": str(pvd_path),
            },
        })
        self.assertIn("result", resp)
        self.assertEqual(resp["result"]["xml_path"], str(xml_path))
        self.assertTrue(xml_path.exists())
        self.assertTrue(pvd_path.exists())

    def test_init_project_refuses_overwrite(self) -> None:
        xml_path = _bootstrap_project(self.tmp)
        resp = handle_request({
            "id": 6, "method": "init_project",
            "params": {
                "name": "X", "short_name": "x",
                "xml_path": str(xml_path),
                "pvd_path": str(self.tmp / "PVD.md"),
            },
        })
        self.assertIn("error", resp)
        self.assertEqual(resp["error"]["code"], project_io.APPLICATION_ERROR)

    def test_unknown_method_returns_method_not_found(self) -> None:
        resp = handle_request({"id": 7, "method": "no_such"})
        self.assertEqual(resp["error"]["code"], project_io.METHOD_NOT_FOUND)

    def test_missing_method_returns_invalid_request(self) -> None:
        resp = handle_request({"id": 8})
        self.assertEqual(resp["error"]["code"], project_io.INVALID_REQUEST)

    def test_invalid_params_returns_invalid_params(self) -> None:
        # render requires template and metadata_id.
        resp = handle_request({"id": 9, "method": "render", "params": {}})
        self.assertEqual(resp["error"]["code"], project_io.INVALID_PARAMS)

    def test_application_error_for_bad_xml_path(self) -> None:
        resp = handle_request({
            "id": 10, "method": "render",
            "params": {
                "template": str(_paths.TEMPLATES_DIR / "HLRs.md.j2"),
                "metadata_id": "HLRs",
                "xml_path": str(self.tmp / "missing.xml"),
            },
        })
        self.assertEqual(resp["error"]["code"], project_io.APPLICATION_ERROR)

    def test_notification_returns_none(self) -> None:
        # JSON-RPC 2.0 notification: explicit jsonrpc, no id.
        resp = handle_request({"jsonrpc": "2.0", "method": "lint"})
        self.assertIsNone(resp)


class ServeStreamTests(unittest.TestCase):
    """Drive serve() with in-memory streams to exercise the loop."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)

    def test_multiple_requests_one_per_line(self) -> None:
        xml_path = _bootstrap_project(self.tmp)
        template = _paths.TEMPLATES_DIR / "HLRs.md.j2"
        requests = [
            {"id": 1, "method": "lint",
             "params": {"xml_path": str(xml_path),
                        "xsd_path": str(_paths.PROJECT_XSD)}},
            {"id": 2, "method": "render",
             "params": {"template": str(template),
                        "metadata_id": "HLRs",
                        "xml_path": str(xml_path)}},
        ]
        stdin = io.StringIO("\n".join(json.dumps(r) for r in requests) + "\n")
        stdout = io.StringIO()
        rc = serve(stdin=stdin, stdout=stdout)
        self.assertEqual(rc, 0)
        lines = [line for line in stdout.getvalue().splitlines() if line]
        self.assertEqual(len(lines), 2)
        ids = [json.loads(line)["id"] for line in lines]
        self.assertEqual(ids, [1, 2])

    def test_invalid_json_returns_parse_error(self) -> None:
        stdin = io.StringIO("not-json\n")
        stdout = io.StringIO()
        serve(stdin=stdin, stdout=stdout)
        resp = json.loads(stdout.getvalue().strip())
        self.assertEqual(resp["error"]["code"], project_io.PARSE_ERROR)

    def test_blank_lines_ignored_and_eof_returns_zero(self) -> None:
        # LLR-SRV-02: blank lines do not produce responses, and EOF
        # without any request returns a clean exit.
        stdin = io.StringIO("\n  \n\n")
        stdout = io.StringIO()
        rc = serve(stdin=stdin, stdout=stdout)
        self.assertEqual(rc, 0)
        self.assertEqual(stdout.getvalue(), "")


class MethodsRegistryTests(unittest.TestCase):
    """LLR-SRV-06: the dispatcher walks a registry table; method
    handlers are not implemented as if/elif branches in handle_request."""

    def test_methods_registry_contains_documented_methods(self) -> None:
        self.assertEqual(
            set(project_io.METHODS.keys()),
            {"lint", "render", "parse_to_json",
             "list_documents", "ui_hints_index", "init_project",
             "apply_edit", "form_schema", "next_free_id",
             "ai_request",
             "merge_three_way", "apply_merge_resolution"},
        )
        for name, handler in project_io.METHODS.items():
            self.assertTrue(callable(handler), msg=f"{name!r} not callable")

    def test_dispatch_routes_through_methods_table(self) -> None:
        # Registering a stub handler at runtime exercises the
        # dispatcher and proves it consults METHODS rather than a
        # hard-coded if/elif chain.
        sentinel = {"echoed": True}
        project_io.METHODS["__test_echo__"] = lambda params: {"params": params, **sentinel}
        try:
            resp = handle_request({
                "id": 99, "method": "__test_echo__",
                "params": {"x": 1},
            })
            self.assertEqual(resp["id"], 99)
            self.assertEqual(resp["result"], {"params": {"x": 1}, "echoed": True})
        finally:
            project_io.METHODS.pop("__test_echo__", None)

    def test_unknown_method_after_unregister_returns_method_not_found(self) -> None:
        # Removing a method from the registry makes it unreachable
        # without any code change in handle_request.
        original = project_io.METHODS.pop("lint")
        try:
            resp = handle_request({"id": 1, "method": "lint", "params": {}})
            self.assertEqual(resp["error"]["code"], project_io.METHOD_NOT_FOUND)
        finally:
            project_io.METHODS["lint"] = original


class SubprocessTests(unittest.TestCase):
    """Drive the actual `python3 tools/project_io.py` process — the
    acceptance criterion from PLAN_vscode_extension.md Phase 0."""

    def test_echo_lint_request_returns_findings(self) -> None:
        request = {
            "id": 1, "method": "lint",
            "params": {
                "xml_path": str(_paths.DOC_PROJECT_XML),
                "xsd_path": str(_paths.PROJECT_XSD),
            },
        }
        proc = subprocess.run(
            [sys.executable, str(_paths.TOOLS_DIR / "project_io.py")],
            input=json.dumps(request) + "\n",
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        resp = json.loads(proc.stdout.strip())
        self.assertEqual(resp["id"], 1)
        self.assertIn("result", resp)
        self.assertIn("errors", resp["result"])

    def test_subprocess_lint_matches_in_process_lint(self) -> None:
        from lint_project import lint as _lint_lib
        cli_findings = _lint_lib(_paths.DOC_PROJECT_XML, _paths.PROJECT_XSD)

        request = {
            "id": 1, "method": "lint",
            "params": {
                "xml_path": str(_paths.DOC_PROJECT_XML),
                "xsd_path": str(_paths.PROJECT_XSD),
            },
        }
        proc = subprocess.run(
            [sys.executable, str(_paths.TOOLS_DIR / "project_io.py")],
            input=json.dumps(request) + "\n",
            capture_output=True,
            text=True,
            timeout=30,
        )
        resp = json.loads(proc.stdout.strip())
        self.assertEqual(resp["result"]["errors"], cli_findings.errors)
        self.assertEqual(resp["result"]["warnings"], cli_findings.warnings)


class UiHintsIndexTests(unittest.TestCase):
    """LLR-UHI-01..03 (Phase 2.5b): the `ui_hints_index` JSON-RPC
    surface distils the `<xs:appinfo>` vocabulary from
    tools/project.xsd into a JSON-serialisable index keyed by
    complex-type name; `parse_to_json` embeds the same dict under
    `_ui_hints_index` so the extension fetches it in one round trip.
    """

    def test_ui_hints_index_method_returns_index(self) -> None:
        resp = handle_request({
            "id": 1, "method": "ui_hints_index",
            "params": {"xsd_path": str(_paths.PROJECT_XSD)},
        })
        self.assertIn("result", resp)
        index = resp["result"]["ui_hints_index"]
        # Every renderable complex type with a ui:* annotation must
        # be present.
        self.assertEqual(
            set(index.keys()),
            {"Document", "SddModule", "Hlr", "Llr", "Test",
             "StpFixture", "TestFile",
             "Plan", "Plan/item"},
        )
        # Hlr carries a tree node, two lenses, and a four-field form.
        hlr = index["Hlr"]
        self.assertEqual(hlr["tree_node"]["id_attr"], "id")
        self.assertEqual(hlr["tree_node"]["group"], "hlrs")
        self.assertEqual(
            sorted(l["kind"] for l in hlr["lenses"]),
            ["coverage", "tracesCount"],
        )
        self.assertEqual(len(hlr["form"]), 4)
        # Document carries the discoverability marker but no tree node.
        self.assertTrue(index["Document"]["document"])
        self.assertIsNone(index["Document"]["tree_node"])
        # The result is JSON-serialisable.
        json.dumps(resp)

    def test_parse_to_json_embeds_ui_hints_index(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        xml_path = _bootstrap_project(Path(tmp.name))
        resp = handle_request({
            "id": 2, "method": "parse_to_json",
            "params": {"xml_path": str(xml_path)},
        })
        self.assertIn("result", resp)
        self.assertIn("_ui_hints_index", resp["result"])
        self.assertIn("Hlr", resp["result"]["_ui_hints_index"])
        # Round-trip through JSON to prove the field is serialisable.
        json.dumps(resp)

    def test_ui_hints_index_records_element_binding(self) -> None:
        """Slice D: each index entry now reports the lowercase XML
        element bound to its complex type so consumers can iterate
        the parsed tree without special-casing per tag."""
        resp = handle_request({
            "id": 3, "method": "ui_hints_index",
            "params": {"xsd_path": str(_paths.PROJECT_XSD)},
        })
        index = resp["result"]["ui_hints_index"]
        self.assertEqual(index["Hlr"]["element"], "hlr")
        self.assertEqual(index["Llr"]["element"], "llr")
        self.assertEqual(index["Test"]["element"], "test")
        self.assertEqual(index["SddModule"]["element"], "module")
        self.assertEqual(index["Plan"]["element"], "plan")
        self.assertEqual(index["Plan/item"]["element"], "item")
        self.assertEqual(index["Document"]["element"], "document")


class NodesIndexTests(unittest.TestCase):
    """Slice D (Phase 2.5b): `parse_to_json` embeds a generic
    `_nodes` map keyed by the same complex-type name as the hints
    index, listing every element bound to a type that carries a
    `ui:treeNode` hint. Consumers iterate this map instead of
    calling per-payload builders.
    """

    FIXTURE = _paths.REPO_ROOT / "test" / "doc" / "Project.xml"

    def test_parse_to_json_embeds_nodes_index(self) -> None:
        resp = handle_request({
            "id": 1, "method": "parse_to_json",
            "params": {"xml_path": str(self.FIXTURE)},
        })
        self.assertIn("result", resp)
        nodes = resp["result"].get("_nodes")
        self.assertIsInstance(nodes, dict)
        # Keys mirror the ui_hints_index entries that have a tree node.
        # Document is excluded (no tree node); every other annotated
        # type is present even when the fixture has zero instances.
        self.assertEqual(
            set(nodes.keys()),
            {"Hlr", "Llr", "Test", "SddModule", "Plan", "Plan/item"},
        )
        # Round-trip through JSON.
        json.dumps(resp)

    def test_plan_payload_surfaces_in_nodes_index(self) -> None:
        """The synthetic `<plan>` payload added in Phase 2.5 Plan-proof
        must appear in `_nodes` without any TS or Python special-casing
        — this is the acceptance criterion for the schema-driven
        projection that Slices E+ will consume."""
        resp = handle_request({
            "id": 1, "method": "parse_to_json",
            "params": {"xml_path": str(self.FIXTURE)},
        })
        nodes = resp["result"]["_nodes"]
        # Exactly one <plan> with a version attribute.
        self.assertEqual(len(nodes["Plan"]), 1)
        plan = nodes["Plan"][0]
        self.assertEqual(plan["tag"], "plan")
        self.assertIn("version", plan["attrs"])
        # Inline Plan/item children are scoped under <plan>, not the
        # whole tree, so unrelated <item> elements would not pollute.
        items = nodes["Plan/item"]
        self.assertGreaterEqual(len(items), 1)
        for item in items:
            self.assertEqual(item["tag"], "item")
            self.assertIn("id", item["attrs"])
        # Each item carries its prose body as `text`.
        self.assertTrue(any(i.get("text") for i in items))


if __name__ == "__main__":
    unittest.main()
