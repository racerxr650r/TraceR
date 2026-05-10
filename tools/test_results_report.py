#!/usr/bin/env python3
"""Generate a consolidated Markdown test-results report from JUnit XML files.

Usage:
    python3 tools/test_results_report.py [--out test_reports/test-report.md]

Parses JUnit XML produced by:
  - Python:    unittest-xml-reporting (one XML per test class in a directory)
  - Mocha:     mocha-junit-reporter   (single XML with <testsuites> root)

Writes a single Markdown summary suitable for GitHub Step Summaries and
sticky PR comments.
"""
from __future__ import annotations

import argparse
import glob
import sys
from pathlib import Path
import defusedxml.ElementTree as ET


# ── JUnit XML parsing ─────────────────────────────────────────────

def _parse_single_junit(path: Path) -> dict:
    """Parse a single JUnit XML file (one <testsuite> or <testsuites>)."""
    tree = ET.parse(path)
    root = tree.getroot()

    suites: list[dict] = []

    if root.tag == "testsuites":
        suite_elems = root.findall("testsuite")
        # Skip empty "Root Suite" nodes (mocha artefact)
        suite_elems = [s for s in suite_elems if int(s.get("tests", 0)) > 0]
    elif root.tag == "testsuite":
        suite_elems = [root]
    else:
        return {"suites": []}

    for suite in suite_elems:
        tests = int(suite.get("tests", 0))
        failures = int(suite.get("failures", 0))
        errors = int(suite.get("errors", 0))
        skipped = int(suite.get("skipped", 0))
        time_s = float(suite.get("time", 0))
        name = suite.get("name", "unknown")

        # Strip the timestamp suffix that xmlrunner appends
        # e.g. "test_render_doc.InitProjectTests-20260503234207"
        if "-" in name and name.rsplit("-", 1)[-1].isdigit():
            name = name.rsplit("-", 1)[0]

        failed_cases: list[dict] = []
        for tc in suite.findall("testcase"):
            failure = tc.find("failure")
            error = tc.find("error")
            if failure is not None:
                failed_cases.append({
                    "name": tc.get("name", ""),
                    "message": failure.get("message", ""),
                    "type": "FAIL",
                })
            elif error is not None:
                failed_cases.append({
                    "name": tc.get("name", ""),
                    "message": error.get("message", ""),
                    "type": "ERROR",
                })

        suites.append({
            "name": name,
            "tests": tests,
            "failures": failures,
            "errors": errors,
            "skipped": skipped,
            "time": time_s,
            "passed": tests - failures - errors - skipped,
            "failed_cases": failed_cases,
        })

    return {"suites": suites}


def _parse_junit_dir(directory: Path) -> dict:
    """Parse a directory of JUnit XML files (one per test class)."""
    all_suites: list[dict] = []
    for xml_path in sorted(directory.glob("TEST-*.xml")):
        data = _parse_single_junit(xml_path)
        all_suites.extend(data["suites"])
    return {"suites": all_suites}


def _aggregate(suites: list[dict]) -> dict:
    """Compute aggregate totals from a list of suite dicts."""
    total = sum(s["tests"] for s in suites)
    passed = sum(s["passed"] for s in suites)
    failed = sum(s["failures"] + s["errors"] for s in suites)
    skipped = sum(s["skipped"] for s in suites)
    time_s = sum(s["time"] for s in suites)
    return {
        "total": total,
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "time": time_s,
    }


# ── Markdown generation ──────────────────────────────────────────

def _status_icon(failed: int) -> str:
    return "✅" if failed == 0 else "❌"


def _format_time(seconds: float) -> str:
    if seconds < 1:
        return f"{seconds * 1000:.0f}ms"
    return f"{seconds:.2f}s"


def _generate_report(
    py_suites: list[dict] | None,
    ext_suites: list[dict] | None,
) -> str:
    lines: list[str] = []
    lines.append("# Test Results Report\n")

    # ── Summary table ─────────────────────────────────────────
    lines.append("## Summary\n")
    lines.append("| Component | Status | Total | Passed | Failed | Skipped | Time |")
    lines.append("|-----------|:------:|:-----:|:------:|:------:|:-------:|-----:|")

    all_suites: list[dict] = []

    if py_suites:
        agg = _aggregate(py_suites)
        icon = _status_icon(agg["failed"])
        lines.append(
            f"| **Python tools** | {icon} "
            f"| {agg['total']} | {agg['passed']} | {agg['failed']} "
            f"| {agg['skipped']} | {_format_time(agg['time'])} |"
        )
        all_suites.extend(py_suites)

    if ext_suites:
        agg = _aggregate(ext_suites)
        icon = _status_icon(agg["failed"])
        lines.append(
            f"| **VS Code extension** | {icon} "
            f"| {agg['total']} | {agg['passed']} | {agg['failed']} "
            f"| {agg['skipped']} | {_format_time(agg['time'])} |"
        )
        all_suites.extend(ext_suites)

    if py_suites and ext_suites:
        agg = _aggregate(all_suites)
        icon = _status_icon(agg["failed"])
        lines.append(
            f"| **Combined** | {icon} "
            f"| {agg['total']} | {agg['passed']} | {agg['failed']} "
            f"| {agg['skipped']} | {_format_time(agg['time'])} |"
        )

    lines.append("")

    # ── Per-suite breakdown ───────────────────────────────────
    def _suite_table(suites: list[dict], heading: str) -> None:
        lines.append(f"## {heading}\n")
        lines.append("| Suite | Status | Total | Passed | Failed | Skipped | Time |")
        lines.append("|-------|:------:|:-----:|:------:|:------:|:-------:|-----:|")
        for s in suites:
            icon = _status_icon(s["failures"] + s["errors"])
            lines.append(
                f"| {s['name']} | {icon} "
                f"| {s['tests']} | {s['passed']} "
                f"| {s['failures'] + s['errors']} "
                f"| {s['skipped']} | {_format_time(s['time'])} |"
            )
        lines.append("")

    if py_suites:
        _suite_table(py_suites, "Python (tools/)")
    if ext_suites:
        _suite_table(ext_suites, "VS Code Extension (test/unit/)")

    # ── Failure details ───────────────────────────────────────
    all_failures = [
        (s["name"], fc)
        for s in all_suites
        for fc in s["failed_cases"]
    ]
    if all_failures:
        lines.append("## Failures\n")
        for suite_name, fc in all_failures:
            lines.append(f"### {fc['type']}: {suite_name} > {fc['name']}\n")
            if fc["message"]:
                lines.append("```")
                lines.append(fc["message"])
                lines.append("```\n")

    return "\n".join(lines)


# ── CLI ───────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate consolidated test-results report from JUnit XML.")
    parser.add_argument(
        "--out", default="test_reports/test-report.md",
        help="Output Markdown file (default: test_reports/test-report.md)")
    parser.add_argument(
        "--py-results-dir", default="test_reports/py-results",
        help="Directory of Python JUnit XML files (default: test_reports/py-results)")
    parser.add_argument(
        "--ext-results-xml", default="test_reports/ext-results.xml",
        help="Extension JUnit XML file (default: test_reports/ext-results.xml)")
    args = parser.parse_args()

    py_dir = Path(args.py_results_dir)
    ext_path = Path(args.ext_results_xml)

    py_suites = None
    if py_dir.is_dir() and list(py_dir.glob("TEST-*.xml")):
        py_suites = _parse_junit_dir(py_dir)["suites"]

    ext_suites = None
    if ext_path.exists():
        ext_suites = _parse_single_junit(ext_path)["suites"]

    if not py_suites and not ext_suites:
        print("ERROR: No JUnit XML results found. Run tests with JUnit "
              "reporting enabled first.", file=sys.stderr)
        return 1

    report = _generate_report(py_suites, ext_suites)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")
    print(f"Report written to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
