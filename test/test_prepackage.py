"""Phase 6 (LLR-PKG-01, LLR-PKG-06): tests for the extension
`prepackage` script that bundles the Python sidecar tree into
`tools/vscode-project-xml/dist/python/`.

These tests run the real `node scripts/prepackage.js` against the
checked-in `tools/` source so we catch breakage of the bundle
contract end-to-end (file set, .bundle_version, .vscodeignore).
"""
from __future__ import annotations

import re
import shutil
import subprocess
import unittest
from pathlib import Path

from _paths import REPO_ROOT, PROJECT_XSD

EXT_ROOT = REPO_ROOT / "tools" / "vscode-project-xml"
DIST_PY = EXT_ROOT / "dist" / "python"


class TestPrepackage(unittest.TestCase):
    """Tests that require a successful `node scripts/prepackage.js` run."""

    _dist_py: Path

    @classmethod
    def setUpClass(cls) -> None:
        if not shutil.which("node"):
            raise unittest.SkipTest("node is not installed; cannot exercise prepackage.js")
        proc = subprocess.run(
            ["node", "scripts/prepackage.js"],
            cwd=str(EXT_ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise AssertionError(
                f"prepackage.js failed: rc={proc.returncode}\n"
                f"stdout={proc.stdout}\nstderr={proc.stderr}"
            )
        cls._dist_py = DIST_PY

    def test_prepackage_writes_required_python_files(self) -> None:
        # LLR-PKG-01: every Python file the sidecar spawns must ship in
        # dist/python/ so the .vsix is fully self-contained (HLR-060).
        for name in (
            "project_io.py",
            "render_doc.py",
            "lint_project.py",
            "project_edit.py",
            "project_merge.py",
            "project.xsd",
        ):
            self.assertTrue(
                (self._dist_py / name).is_file(), f"missing bundled {name}"
            )

    def test_prepackage_writes_template_and_ai_dirs(self) -> None:
        # LLR-PKG-01: the templates/ and ai/ packages must come along too.
        self.assertTrue((self._dist_py / "templates").is_dir())
        self.assertTrue((self._dist_py / "ai").is_dir())
        # Sanity: at least one Jinja2 template + the ai package marker.
        self.assertTrue(any((self._dist_py / "templates").glob("*.j2")))
        self.assertTrue((self._dist_py / "ai" / "__init__.py").is_file())

    def test_prepackage_writes_bundle_version(self) -> None:
        # LLR-PKG-06: .bundle_version carries the bundled XSD's
        # `version` attribute (the Project.xml schema_version baseline
        # the bundled XSD accepts) for the activation freshness check.
        pinned = (self._dist_py / ".bundle_version").read_text(encoding="utf8").strip()
        self.assertTrue(pinned, ".bundle_version must be a non-empty single line")

        xsd_text = PROJECT_XSD.read_text(encoding="utf8")
        # The XSD root element MUST carry version="X.Y" so prepackage
        # has a single source of truth for the bundle pin.
        self.assertIn('version="', xsd_text.split("<xs:schema", 1)[1].split(">", 1)[0])
        # And the pin in dist/ must match the source XSD's version.
        match = re.search(r"<xs:schema\b[^>]*\sversion\s*=\s*\"([^\"]+)\"", xsd_text)
        self.assertIsNotNone(match, "tools/project.xsd must have version=\"X.Y\" on xs:schema")
        assert match is not None  # for type-checker
        self.assertEqual(
            pinned, match.group(1),
            f"bundled .bundle_version ({pinned}) does not match source XSD ({match.group(1)})",
        )

    def test_prepackage_bundles_screenshots(self) -> None:
        # The User Manual references screenshots via ../images/screenshots/
        # relative paths, so they must land in dist/images/screenshots/.
        screenshots_dir = self._dist_py.parent / "images" / "screenshots"
        self.assertTrue(screenshots_dir.is_dir(), "dist/images/screenshots/ missing")
        pngs = list(screenshots_dir.glob("*.png"))
        self.assertGreaterEqual(len(pngs), 1, "no .png files found in dist/images/screenshots/")

    def test_prepackage_bundles_third_party_python_dependencies(self) -> None:
        # LLR-PKG-12: prepackage vendors runtime Python dependencies so
        # the bundled sidecar can start in a workspace that has Python
        # but no pre-installed TraceR packages.
        expected = ("defusedxml", "jinja2", "lxml")
        missing = [name for name in expected if not (self._dist_py / name).exists()]
        self.assertEqual(missing, [], f"missing bundled dependency dirs: {missing}")


class TestVscodeignore(unittest.TestCase):
    """Tests that do NOT require a prepackage run."""

    def test_vscodeignore_does_not_exclude_bundled_python(self) -> None:
        # LLR-PKG-01 final clause: `.vscodeignore` must NOT exclude
        # `dist/python/**`, otherwise vsce package would drop the bundle.
        text = (EXT_ROOT / ".vscodeignore").read_text(encoding="utf8")
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if stripped.startswith("!"):
                continue
            # Crude but effective: any glob that would match dist/python/
            # would either be `dist/**`, `dist/python/**`, or similar.
            self.assertFalse(
                stripped.startswith("dist/python"),
                f".vscodeignore line `{stripped}` would drop the bundled sidecar",
            )
            self.assertNotIn(
                stripped, {"dist", "dist/", "dist/**", "dist/**/*"},
                f".vscodeignore line `{stripped}` would drop the bundled sidecar",
            )


class TestMakefileTargets(unittest.TestCase):
    """HLR-037..040: Makefile defines required build/install targets."""

    _MAKEFILE = REPO_ROOT / "tools" / "Makefile"

    def _makefile_targets(self) -> set:
        text = self._MAKEFILE.read_text(encoding="utf-8")
        return set(re.findall(r"^([a-z][a-z0-9_-]*):", text, re.MULTILINE))

    def test_cross_platform_prereqs_targets_exist(self) -> None:
        # HLR-037: Makefile exposes per-distro prereq install targets.
        targets = self._makefile_targets()
        for t in ("prereqs-debian", "prereqs-fedora", "prereqs-arch", "prereqs-macos"):
            self.assertIn(t, targets, f"Missing Makefile target: {t}")

    def test_prereqs_ci_target_exists(self) -> None:
        # HLR-038: slim CI prereq target.
        self.assertIn("prereqs-ci", self._makefile_targets())

    def test_ci_umbrella_target_exists(self) -> None:
        # HLR-039: CI umbrella target.
        self.assertIn("ci", self._makefile_targets())

    def test_bootstrap_target_exists(self) -> None:
        # HLR-040: bootstrap target.
        self.assertIn("bootstrap", self._makefile_targets())


class TestPackageJson(unittest.TestCase):
    """Tests for package.json static properties (no build required)."""

    _PKG = EXT_ROOT / "package.json"

    def test_activation_events_include_required_commands(self) -> None:
        # LLR-PKG-03: activationEvents must include initProject and
        # scaffoldTools commands so the extension activates when invoked
        # from the command palette before any workspace file is open.
        import json
        pkg = json.loads(self._PKG.read_text(encoding="utf-8"))
        events = set(pkg.get("activationEvents", []))
        for cmd in (
            "onCommand:projectXml.initProject",
            "onCommand:projectXml.scaffoldTools",
        ):
            self.assertIn(cmd, events, f"activationEvents missing: {cmd}")
