"""Tests for tools/ai/registry.py — intent catalog (HLR-029, HLR-053)."""
from __future__ import annotations

import unittest

import _paths  # noqa: F401  (path bootstrap)

from ai import registry


class IntentCatalogTests(unittest.TestCase):
    def test_required_intents_registered(self) -> None:
        expected = {
            "draft.module", "draft.hlr", "draft.llr", "draft.test",
            "draft.pvd", "expand.hlr_to_llrs", "expand.llr_to_tests",
            "review.item", "suggest.traces", "gap.fix",
        }
        self.assertEqual(set(registry.INTENTS.keys()), expected)

    def test_each_intent_has_schema_and_prompt_files(self) -> None:
        for spec in registry.INTENTS.values():
            self.assertTrue(spec.schema_path.exists(),
                            msg=f"missing schema for {spec.id}: {spec.schema_path}")
            self.assertTrue(spec.prompt_path.exists(),
                            msg=f"missing prompt for {spec.id}: {spec.prompt_path}")

    def test_ai_actions_for_type_matches_targets(self) -> None:
        hlr = registry.ai_actions_for_type("Hlr")
        self.assertIn("draft.hlr", hlr)
        self.assertIn("expand.hlr_to_llrs", hlr)
        self.assertIn("review.item", hlr)
        # Test type should not include HLR drafting.
        test = registry.ai_actions_for_type("Test")
        self.assertNotIn("draft.hlr", test)
        self.assertIn("draft.test", test)

    def test_get_intent_unknown_raises(self) -> None:
        with self.assertRaises(KeyError):
            registry.get_intent("not.a.real.intent")


if __name__ == "__main__":
    unittest.main()
