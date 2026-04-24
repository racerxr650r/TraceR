"""Shared helpers for tests under test/.

Adds the repo's tools/ directory to sys.path so test modules can
import render_doc, lint_project, and project_io directly.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = REPO_ROOT / "tools"
TEMPLATES_DIR = TOOLS_DIR / "templates"
DOC_PROJECT_XML = REPO_ROOT / "doc" / "Project.xml"
PROJECT_XSD = TOOLS_DIR / "project.xsd"

if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))
