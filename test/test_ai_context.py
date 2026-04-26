"""Tests for tools/ai/context.py — grounding bundle (HLR-029, HLR-031)."""
from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401

from ai import context
from ai.context import TargetSpec, build_context, render_system_prompt
from render_doc import init_project


class BundleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="tracer-ai-ctx-"))
        self.xml = self.tmp / "Project.xml"
        init_project(
            name="Ctx Test",
            short_name="CT",
            author="tester",
            xml_path=self.xml,
            pvd_path=self.tmp / "PVD.md",
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_build_context_populates_required_fields(self) -> None:
        bundle = build_context(
            "draft.hlr",
            TargetSpec(type="Hlr", section="1"),
            "User wants a new HLR.",
            response_schema={"type": "object", "required": ["name", "text"]},
            xml_path=self.xml,
        )
        self.assertEqual(bundle.intent, "draft.hlr")
        self.assertEqual(bundle.target["type"], "Hlr")
        self.assertTrue(bundle.schema_excerpt)
        self.assertGreater(bundle.estimated_tokens, 0)

    def test_render_system_prompt_includes_user_prompt_and_schema(self) -> None:
        bundle = build_context(
            "draft.hlr",
            TargetSpec(type="Hlr", section="1"),
            "Make it pop.",
            response_schema={"type": "object"},
            xml_path=self.xml,
        )
        text = render_system_prompt(bundle, "## Intent prompt body\n\n{{user_prompt}}")
        # The user prompt must always appear verbatim (HLR-029).
        self.assertIn("Make it pop.", text)

    def test_budget_truncation_keeps_critical_sections(self) -> None:
        # Tiny budget forces the packer to drop optional sections but
        # must never drop intent/user/target/schema.
        bundle = build_context(
            "draft.hlr",
            TargetSpec(type="Hlr", section="1"),
            "U" * 200,
            response_schema={"type": "object"},
            xml_path=self.xml,
            max_tokens=1024,
        )
        self.assertIn("U" * 200, bundle.user_prompt)
        self.assertTrue(bundle.schema_excerpt)


if __name__ == "__main__":
    unittest.main()
