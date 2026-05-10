#!/usr/bin/env python3
"""Generate a consolidated Markdown coverage report from Cobertura XML files.

Usage:
    python3 tools/coverage_report.py [--out test_reports/coverage_report.md]

Parses test_reports/coverage.xml (Python) and test_reports/ext-coverage.xml
(TypeScript extension) and writes a single Markdown summary to the output path.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from xml.etree import ElementTree as ET


def _parse_cobertura(path: Path) -> dict:
    """Parse a Cobertura XML file and return summary + per-file data."""
    tree = ET.parse(path)
    root = tree.getroot()

    line_rate = float(root.get("line-rate", 0))
    branch_rate = float(root.get("branch-rate", 0))
    lines_valid = int(root.get("lines-valid", 0))
    lines_covered = int(root.get("lines-covered", 0))
    branches_valid = int(root.get("branches-valid", 0))
    branches_covered = int(root.get("branches-covered", 0))

    files: list[dict] = []
    for pkg in root.findall(".//package"):
        for cls in pkg.findall(".//class"):
            filename = cls.get("filename", "")
            f_line_rate = float(cls.get("line-rate", 0))
            f_branch_rate = float(cls.get("branch-rate", 0))
            lines = cls.findall(".//line")
            total_lines = len(lines)
            hit_lines = sum(1 for l in lines if int(l.get("hits", 0)) > 0)
            files.append({
                "filename": filename,
                "line_rate": f_line_rate,
                "branch_rate": f_branch_rate,
                "lines_total": total_lines,
                "lines_hit": hit_lines,
            })

    return {
        "line_rate": line_rate,
        "branch_rate": branch_rate,
        "lines_valid": lines_valid,
        "lines_covered": lines_covered,
        "branches_valid": branches_valid,
        "branches_covered": branches_covered,
        "files": sorted(files, key=lambda f: f["filename"]),
    }


def _pct(rate: float) -> str:
    return f"{rate * 100:.1f}%"


def _generate_report(py_data: dict | None, ext_data: dict | None) -> str:
    """Generate Markdown report from parsed coverage data."""
    lines: list[str] = []
    lines.append("# Test Coverage Report\n")

    # ── Summary table ─────────────────────────────────────────────
    lines.append("## Summary\n")
    lines.append("| Component | Line Coverage | Branch Coverage | Lines (hit/total) | Branches (hit/total) |")
    lines.append("|-----------|:------------:|:--------------:|:-----------------:|:--------------------:|")

    total_lines_valid = 0
    total_lines_covered = 0
    total_branches_valid = 0
    total_branches_covered = 0

    if py_data:
        lines.append(
            f"| **Python tools** | {_pct(py_data['line_rate'])} "
            f"| {_pct(py_data['branch_rate'])} "
            f"| {py_data['lines_covered']}/{py_data['lines_valid']} "
            f"| {py_data['branches_covered']}/{py_data['branches_valid']} |"
        )
        total_lines_valid += py_data["lines_valid"]
        total_lines_covered += py_data["lines_covered"]
        total_branches_valid += py_data["branches_valid"]
        total_branches_covered += py_data["branches_covered"]

    if ext_data:
        lines.append(
            f"| **VS Code extension** | {_pct(ext_data['line_rate'])} "
            f"| {_pct(ext_data['branch_rate'])} "
            f"| {ext_data['lines_covered']}/{ext_data['lines_valid']} "
            f"| {ext_data['branches_covered']}/{ext_data['branches_valid']} |"
        )
        total_lines_valid += ext_data["lines_valid"]
        total_lines_covered += ext_data["lines_covered"]
        total_branches_valid += ext_data["branches_valid"]
        total_branches_covered += ext_data["branches_covered"]

    if py_data and ext_data:
        combined_line = total_lines_covered / total_lines_valid if total_lines_valid else 0
        combined_branch = total_branches_covered / total_branches_valid if total_branches_valid else 0
        lines.append(
            f"| **Combined** | {_pct(combined_line)} "
            f"| {_pct(combined_branch)} "
            f"| {total_lines_covered}/{total_lines_valid} "
            f"| {total_branches_covered}/{total_branches_valid} |"
        )

    lines.append("")

    # ── Per-file tables ───────────────────────────────────────────
    if py_data and py_data["files"]:
        lines.append("## Python (tools/)\n")
        lines.append("| File | Line % | Branch % | Lines (hit/total) |")
        lines.append("|------|:------:|:--------:|:-----------------:|")
        for f in py_data["files"]:
            lines.append(
                f"| {f['filename']} | {_pct(f['line_rate'])} "
                f"| {_pct(f['branch_rate'])} "
                f"| {f['lines_hit']}/{f['lines_total']} |"
            )
        lines.append("")

    if ext_data and ext_data["files"]:
        lines.append("## VS Code Extension (src/)\n")
        lines.append("| File | Line % | Branch % | Lines (hit/total) |")
        lines.append("|------|:------:|:--------:|:-----------------:|")
        for f in ext_data["files"]:
            lines.append(
                f"| {f['filename']} | {_pct(f['line_rate'])} "
                f"| {_pct(f['branch_rate'])} "
                f"| {f['lines_hit']}/{f['lines_total']} |"
            )
        lines.append("")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate consolidated coverage report.")
    parser.add_argument("--out", default="test_reports/coverage_report.md",
                        help="Output Markdown file (default: test_reports/coverage_report.md)")
    parser.add_argument("--py-xml", default="test_reports/coverage.xml",
                        help="Python Cobertura XML (default: test_reports/coverage.xml)")
    parser.add_argument("--ext-xml", default="test_reports/ext-coverage.xml",
                        help="Extension Cobertura XML (default: test_reports/ext-coverage.xml)")
    args = parser.parse_args()

    py_path = Path(args.py_xml)
    ext_path = Path(args.ext_xml)

    py_data = _parse_cobertura(py_path) if py_path.exists() else None
    ext_data = _parse_cobertura(ext_path) if ext_path.exists() else None

    if not py_data and not ext_data:
        print("ERROR: No coverage XML files found. Run 'make coverage' and/or "
              "'make ext-coverage' first.", file=sys.stderr)
        return 1

    report = _generate_report(py_data, ext_data)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")
    print(f"Report written to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
