#!/usr/bin/env python3
"""Generate a consolidated Markdown static-analysis report from JSON outputs.

Usage:
    python3 tools/analyze_report.py [--out test_reports/analyze-report.md]

Parses the JSON reports produced by the individual analyze-* Makefile targets
(Bandit, pip-audit, ESLint, npm audit, Semgrep) and writes a single Markdown
summary suitable for GitHub Step Summaries and sticky PR comments.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


# ── Individual report parsers ─────────────────────────────────────

def _parse_bandit(path: Path) -> dict | None:
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    totals = data.get("metrics", {}).get("_totals", {})
    results = data.get("results", [])

    by_severity: dict[str, list[dict]] = {"HIGH": [], "MEDIUM": [], "LOW": []}
    for r in results:
        sev = r.get("issue_severity", "LOW")
        by_severity.setdefault(sev, []).append(r)

    return {
        "high": int(totals.get("SEVERITY.HIGH", 0)),
        "medium": int(totals.get("SEVERITY.MEDIUM", 0)),
        "low": int(totals.get("SEVERITY.LOW", 0)),
        "results": results,
        "by_severity": by_severity,
    }


def _parse_pip_audit(path: Path) -> dict | None:
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    deps = data.get("dependencies", [])
    vulnerable = [d for d in deps if d.get("vulns")]
    return {
        "total_deps": len(deps),
        "vulnerable_count": len(vulnerable),
        "vulnerable": vulnerable,
    }


def _parse_eslint(path: Path) -> dict | None:
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    errors = sum(f.get("errorCount", 0) for f in data)
    warnings = sum(f.get("warningCount", 0) for f in data)

    issues: list[dict] = []
    for f in data:
        fp = f.get("filePath", "")
        for msg in f.get("messages", []):
            issues.append({
                "file": fp,
                "line": msg.get("line", 0),
                "severity": "error" if msg.get("severity") == 2 else "warning",
                "rule": msg.get("ruleId", ""),
                "message": msg.get("message", ""),
            })
    return {
        "errors": errors,
        "warnings": warnings,
        "issues": issues,
    }


def _parse_npm_audit(path: Path) -> dict | None:
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    meta = data.get("metadata", {}).get("vulnerabilities", {})
    vulns = data.get("vulnerabilities", {})

    details: list[dict] = []
    for name, info in vulns.items():
        details.append({
            "package": name,
            "severity": info.get("severity", "unknown"),
            "title": info.get("via", [{}])[0].get("title", "") if isinstance(info.get("via", [None])[0], dict) else str(info.get("via", [""])[0]),
            "fix_available": info.get("fixAvailable", False),
        })

    return {
        "critical": meta.get("critical", 0),
        "high": meta.get("high", 0),
        "moderate": meta.get("moderate", 0),
        "low": meta.get("low", 0),
        "info": meta.get("info", 0),
        "total": meta.get("total", 0),
        "details": details,
    }


def _parse_semgrep(path: Path) -> dict | None:
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    results = data.get("results", [])

    findings: list[dict] = []
    for r in results:
        findings.append({
            "file": r.get("path", ""),
            "line": r.get("start", {}).get("line", 0),
            "rule": r.get("check_id", ""),
            "message": r.get("extra", {}).get("message", ""),
            "severity": r.get("extra", {}).get("severity", ""),
        })
    return {
        "count": len(results),
        "findings": findings,
    }


# ── Report generation ─────────────────────────────────────────────

def _generate_report(
    bandit: dict | None,
    pip_audit: dict | None,
    eslint: dict | None,
    npm_audit: dict | None,
    semgrep: dict | None,
) -> str:
    lines: list[str] = []
    lines.append("# Static Analysis Report\n")

    # ── Summary table ─────────────────────────────────────────
    lines.append("## Summary\n")
    lines.append("| Tool | Scope | Findings |")
    lines.append("|------|-------|----------|")

    if bandit:
        total = bandit["high"] + bandit["medium"] + bandit["low"]
        lines.append(
            f"| **Bandit** | Python security | "
            f"{total} ({bandit['high']} high, {bandit['medium']} medium, "
            f"{bandit['low']} low) |"
        )
    else:
        lines.append("| **Bandit** | Python security | _(not run)_ |")

    if pip_audit:
        lines.append(
            f"| **pip-audit** | Python dependencies | "
            f"{pip_audit['vulnerable_count']} vulnerable "
            f"(of {pip_audit['total_deps']} packages) |"
        )
    else:
        lines.append("| **pip-audit** | Python dependencies | _(not run)_ |")

    if eslint:
        lines.append(
            f"| **ESLint** | TypeScript security + quality | "
            f"{eslint['errors']} errors, {eslint['warnings']} warnings |"
        )
    else:
        lines.append("| **ESLint** | TypeScript security + quality | _(not run)_ |")

    if npm_audit:
        lines.append(
            f"| **npm audit** | Node dependencies | "
            f"{npm_audit['total']} ({npm_audit['critical']} critical, "
            f"{npm_audit['high']} high, {npm_audit['moderate']} moderate, "
            f"{npm_audit['low']} low) |"
        )
    else:
        lines.append("| **npm audit** | Node dependencies | _(not run)_ |")

    if semgrep:
        lines.append(
            f"| **Semgrep** | OWASP (Python + TypeScript) | "
            f"{semgrep['count']} findings |"
        )
    else:
        lines.append("| **Semgrep** | OWASP (Python + TypeScript) | _(not run)_ |")

    lines.append("")

    # ── Bandit details ────────────────────────────────────────
    if bandit and bandit["results"]:
        lines.append("## Bandit — Python Security\n")
        lines.append("| Severity | File | Line | Issue | Confidence |")
        lines.append("|----------|------|:----:|-------|:----------:|")
        for r in sorted(bandit["results"],
                        key=lambda x: {"HIGH": 0, "MEDIUM": 1, "LOW": 2}.get(
                            x.get("issue_severity", "LOW"), 3)):
            fname = r.get("filename", "")
            lines.append(
                f"| {r.get('issue_severity', '')} | {fname} | "
                f"{r.get('line_number', '')} | "
                f"{r.get('issue_text', '')} ({r.get('test_id', '')}) | "
                f"{r.get('issue_confidence', '')} |"
            )
        lines.append("")

    # ── pip-audit details ─────────────────────────────────────
    if pip_audit and pip_audit["vulnerable"]:
        lines.append("## pip-audit — Python Dependencies\n")
        lines.append("| Package | Version | Vulnerability | Fix |")
        lines.append("|---------|---------|---------------|-----|")
        for dep in pip_audit["vulnerable"]:
            for vuln in dep.get("vulns", []):
                lines.append(
                    f"| {dep.get('name', '')} | {dep.get('version', '')} | "
                    f"{vuln.get('id', '')} — {vuln.get('description', '')[:80]} | "
                    f"{vuln.get('fix_versions', ['—'])[0] if vuln.get('fix_versions') else '—'} |"
                )
        lines.append("")

    # ── ESLint details ────────────────────────────────────────
    if eslint and eslint["issues"]:
        lines.append("## ESLint — TypeScript Security + Quality\n")
        lines.append("| Severity | File | Line | Rule | Message |")
        lines.append("|----------|------|:----:|------|---------|")
        for issue in eslint["issues"]:
            fname = issue["file"].split("/src/")[-1] if "/src/" in issue["file"] else issue["file"]
            lines.append(
                f"| {issue['severity']} | src/{fname} | "
                f"{issue['line']} | `{issue['rule']}` | "
                f"{issue['message'][:80]} |"
            )
        lines.append("")

    # ── npm audit details ─────────────────────────────────────
    if npm_audit and npm_audit["details"]:
        lines.append("## npm audit — Node Dependencies\n")
        lines.append("| Severity | Package | Issue | Fix Available |")
        lines.append("|----------|---------|-------|:-------------:|")
        for d in sorted(npm_audit["details"],
                        key=lambda x: {"critical": 0, "high": 1, "moderate": 2,
                                       "low": 3}.get(x["severity"], 4)):
            fix = "✅" if d["fix_available"] else "❌"
            lines.append(
                f"| {d['severity']} | {d['package']} | "
                f"{d['title'][:60]} | {fix} |"
            )
        lines.append("")

    # ── Semgrep details ───────────────────────────────────────
    if semgrep and semgrep["findings"]:
        lines.append("## Semgrep — OWASP Findings\n")
        lines.append("| Severity | File | Line | Rule | Message |")
        lines.append("|----------|------|:----:|------|---------|")
        for f in semgrep["findings"]:
            rule_short = f["rule"].split(".")[-1] if "." in f["rule"] else f["rule"]
            lines.append(
                f"| {f['severity']} | {f['file']} | "
                f"{f['line']} | `{rule_short}` | "
                f"{f['message'][:80]} |"
            )
        lines.append("")

    return "\n".join(lines)


# ── CLI ───────────────────────────────────────────────────────────

def _has_errors(
    bandit: dict | None,
    pip_audit: dict | None,
    eslint: dict | None,
    npm_audit: dict | None,
    semgrep: dict | None,
) -> bool:
    """Return True if any tool reports error-level findings.

    Error-level thresholds:
      - Bandit: HIGH severity
      - ESLint: error count > 0
      - npm audit: critical or high
      - Semgrep: ERROR severity
      - pip-audit: not treated as blocking (informational)
    """
    if bandit and bandit["high"] > 0:
        return True
    if eslint and eslint["errors"] > 0:
        return True
    if npm_audit and (npm_audit["critical"] > 0 or npm_audit["high"] > 0):
        return True
    if semgrep:
        for f in semgrep["findings"]:
            if f.get("severity", "").upper() == "ERROR":
                return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate consolidated static-analysis report.")
    parser.add_argument(
        "--out", default="test_reports/analyze-report.md",
        help="Output Markdown file (default: test_reports/analyze-report.md)")
    parser.add_argument(
        "--bandit", default="test_reports/bandit-report.json",
        help="Bandit JSON report path")
    parser.add_argument(
        "--pip-audit", default="test_reports/pip-audit-report.json",
        help="pip-audit JSON report path")
    parser.add_argument(
        "--eslint", default="test_reports/eslint-report.json",
        help="ESLint JSON report path")
    parser.add_argument(
        "--npm-audit", default="test_reports/npm-audit-report.json",
        help="npm audit JSON report path")
    parser.add_argument(
        "--semgrep", default="test_reports/semgrep-report.json",
        help="Semgrep JSON report path")
    parser.add_argument(
        "--exit-code", action="store_true",
        help="Exit with code 1 if error-level findings are present "
             "(HIGH bandit, ESLint errors, critical/high npm audit, "
             "ERROR semgrep). Warnings do not cause failure.")
    args = parser.parse_args()

    bandit = _parse_bandit(Path(args.bandit))
    pip_audit = _parse_pip_audit(Path(args.pip_audit))
    eslint = _parse_eslint(Path(args.eslint))
    npm_audit = _parse_npm_audit(Path(args.npm_audit))
    semgrep = _parse_semgrep(Path(args.semgrep))

    if not any([bandit, pip_audit, eslint, npm_audit, semgrep]):
        print("ERROR: No analysis report JSON files found. Run "
              "'make -C tools analyze' first.", file=sys.stderr)
        return 1

    report = _generate_report(bandit, pip_audit, eslint, npm_audit, semgrep)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")
    print(f"Report written to {out_path}")

    if args.exit_code and _has_errors(bandit, pip_audit, eslint, npm_audit, semgrep):
        print("ERROR: Error-level findings detected (see report above).",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
