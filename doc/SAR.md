# Security Audit Report: TraceR (tracer)

**Version:** 0.2
**Date:** 2026-05-10
**Author(s):** AI-assisted (via PR prompt)

> **How to use this template.** Each section below contains the
> *intent* of the section followed by **prompts** to elicit the
> content. Replace every `<placeholder>` and the prompt block with
> your own prose. Delete prompts once a section is filled in.

## 1. Purpose

This Security Audit Report (SAR) documents the security posture of
TraceR, including the methodology used, findings from static
and dynamic analysis, and recommendations for remediation.

This document is a point-in-time assessment. For the living list of
known vulnerabilities and their status, see the companion
[Vulnerability Report](VR.md).

## 2. Scope & Methodology

| Aspect | Detail |
| ------ | ------ |
| **Components in scope** | Python sidecar tools (`tools/*.py`, `tools/ai/`), VS Code extension TypeScript source (`tools/vscode-project-xml/src/`), Python and Node.js dependencies |
| **Tools used** | Bandit (Python SAST), pip-audit (Python dependency CVEs), ESLint + eslint-plugin-security (TypeScript SAST), npm audit (Node dependency CVEs), Semgrep (OWASP community rules — Python + TypeScript) |
| **Manual review** | No — automated static analysis only in this pass |
| **Commit / version** | `203bc972` (branch `38-phase-13---static-analysis-and-vulnerabilities`) |
| **Date of audit** | 2026-05-10 |
| **Exclusions** | DAST, penetration testing, infrastructure/deployment configs, test code (`test/`), generated build output (`dist/`, `out/`) |

## 3. Security Architecture Overview

TraceR is a VS Code extension with a Python sidecar process. The
security-relevant architecture is:

- **Trust boundary:** The extension runs in VS Code's Extension Host
  with full workspace file-system access. The Python sidecar is
  spawned as a child process and communicates over stdin/stdout
  JSON-RPC. Both operate with the user's local privileges.
- **Untrusted input entry points:**
  - `doc/Project.xml` — authored by the user; parsed by
    `xml.etree.ElementTree` (Python) and Red Hat XML (VS Code).
  - AI model responses — returned from `vscode.lm.*` API calls;
    validated against JSON Schemas before any `apply_edit` write.
  - Git merge blobs (`:1:`, `:2:`, `:3:`) — read from the local
    repo during conflict resolution.
- **Authentication / authorisation:** None — this is a local dev tool.
  AI model access is gated by VS Code's Copilot authentication.
- **Secrets management:** No secrets are stored. The only token is the
  VS Code Marketplace PAT (`VSCE_PAT`), which lives in GitHub Actions
  secrets and is never exposed to the extension runtime.
- **Data flows:** Workspace files → Python sidecar (JSON-RPC) →
  extension (tree view, diagnostics, forms) → user; AI grounding
  bundles → LLM → validated response → diff preview → user approval
  → `apply_edit`.

## 4. Integration with the Traceability Stack

Security requirements in this project are tracked through the same
traceability mechanism as all other requirements:

1. **Security concerns** are documented as components or constraints
   in the [Software Design Document](SDD.md).
2. **Security requirements** are captured as High-Level Requirements
   (HLRs) in [Project.xml](Project.xml) — typically prefixed
   `HLR-SEC-*` — and traced to the SDD component they implement.
3. **Implementation details** are captured as Low-Level Requirements
   (LLRs) traced to their parent HLR(s).
4. **Verification** is captured as test cases in the
   [Software Test Plan](STP.md), traced to the LLR(s) they verify.
5. **Coverage** is visible in the
   [Traceability Matrix](Traceability.md) — gaps in security
   test coverage appear as lint warnings alongside all other
   coverage gaps.

This audit report is an *assessment artefact* — it validates that
the above process is being followed and identifies gaps. It is not
itself integrated into the traceability matrix.

## 5. OWASP Top 10 / CWE Analysis

| # | OWASP Category | Applicability | Status | Notes |
|---|----------------|---------------|--------|-------|
| A01 | Broken Access Control | N/A | N/A | Local desktop tool — no network-exposed access control surfaces. |
| A02 | Cryptographic Failures | N/A | N/A | No encryption, hashing, or secret storage performed by the extension. |
| A03 | Injection | Applicable | Accepted risk | XML parsing uses `xml.etree.ElementTree` on locally-authored `Project.xml` files (trusted input). Jinja2 renders Markdown templates (not HTML served to browsers). Subprocess calls use fixed executables (`xmllint`). See §6 for details. |
| A04 | Insecure Design | N/A | N/A | No authentication, session, or privilege-escalation surfaces. AI responses are schema-validated and diff-previewed before application. |
| A05 | Security Misconfiguration | N/A | N/A | No server, container, or cloud configuration. Extension settings are user-scoped. |
| A06 | Vulnerable/Outdated Components | Applicable | Open | npm audit reports 8 vulnerabilities (4 high, 4 moderate) in transitive dependencies. See §7 and [VR.md](VR.md). |
| A07 | Identification/Authentication Failures | N/A | N/A | No user authentication. AI model access delegated to VS Code Copilot auth. |
| A08 | Software/Data Integrity Failures | N/A | Mitigated | Extension bundled via esbuild; `.vsix` published through CI with a gated PAT. AI edits require user approval (no auto-apply). |
| A09 | Security Logging/Monitoring Failures | N/A | N/A | Local tool — no runtime logging requirements. AI provenance logged to `.edit_doc/ai_history.jsonl`. |
| A10 | Server-Side Request Forgery | N/A | N/A | No server-side components; no outbound requests except via VS Code's LLM API (user-initiated). |

## 6. Static Analysis Findings

Automated SAST was run on 2026-05-10 using Bandit, ESLint + eslint-plugin-security, and Semgrep. Findings are categorised below with dispositions.

### 6.1 Bandit — Python Security (30 findings)

| Severity | Tool | Rule/CWE | Location | Disposition | Notes |
|----------|------|----------|----------|-------------|-------|
| HIGH | Bandit | B701 (Jinja2 autoescape) | render_doc.py:1380 | Accepted risk | Renders Markdown templates, not HTML served to browsers. XSS is not applicable — output is `.md` files consumed by GitHub/VS Code renderers, not a web app. |
| MEDIUM | Bandit | B314 (xml.etree.ElementTree.parse) | ai/translators.py:87, :439; coverage_report.py:20; lint_project.py:161; project_edit.py:268, :805, :826; render_doc.py:191, :290, :728, :968, :1032; test_results_report.py:27 | Accepted risk | All 13 sites parse locally-authored `Project.xml` or CI-generated XML reports (JUnit, Cobertura). These are trusted files under the developer's control — not untrusted network input. XXE is not exploitable in this context. |
| LOW | Bandit | B405 (xml.etree.ElementTree import) | ai/translators.py:85, :437; coverage_report.py:15; lint_project.py:44; project_edit.py:264, :803, :824; render_doc.py:19; test_results_report.py:20 | Accepted risk | Import-level companion to B314 above — same justification applies. |
| LOW | Bandit | B404 (subprocess import) | lint_project.py:42; render_doc.py:1362 | Accepted risk | `subprocess` is used to invoke `xmllint` with fixed arguments for XSD validation. No user-controlled input reaches the command line. |
| LOW | Bandit | B603/B607 (subprocess call) | lint_project.py:203; render_doc.py:1375 | Accepted risk | Invokes `xmllint` with a hardcoded executable name and file paths derived from the workspace (not user-supplied strings from untrusted sources). |
| LOW | Bandit | B101 (assert) | project_edit.py:409, :420 | Accepted risk | Assertions guard internal invariants in edit logic; these are developer-facing tools, not production services where `-O` stripping is a concern. |

### 6.2 ESLint — TypeScript Security + Quality (1 error, 48 warnings)

| Severity | Tool | Rule/CWE | Location | Disposition | Notes |
|----------|------|----------|----------|-------------|-------|
| error | ESLint | `no-useless-escape` | formLogic.ts:412 | Open | Unnecessary escape character in regex — should be fixed. |
| warning | ESLint | `security/detect-object-injection` (15×) | capabilities.ts, treeMenu.ts, QuickFixProvider.ts, coverageLensLogic.ts, lintMapping.ts, formLogic.ts, formMain.tsx, treeLogic.ts, freshness.ts, locator.ts | Accepted risk | All flagged sites use string keys from schema-defined enums or parsed JSON-RPC responses, not arbitrary user input. Object injection is not exploitable. |
| warning | ESLint | `security/detect-non-literal-fs-filename` (20×) | initProject.ts, scaffoldTools.ts, sidecar.ts, freshness.ts, paths.ts, MergeConflictResolver.ts | Accepted risk | File paths are constructed from `vscode.workspace.workspaceFolders` and known subpaths — all within the trusted workspace boundary. |
| warning | ESLint | `security/detect-non-literal-regexp` (5×) | fixes.ts, coverageLensLogic.ts, locator.ts | Accepted risk | Regex patterns are built from schema-derived element names and id attributes, not arbitrary user input. |
| warning | ESLint | `security/detect-unsafe-regex` (2×) | fixes.ts:95, locator.ts:182 | Accepted risk | Patterns match fixed XML id/tag formats with bounded repetition; ReDoS is not feasible on the input domain. |

### 6.3 Semgrep — OWASP (44 findings)

| Severity | Tool | Rule/CWE | Location | Disposition | Notes |
|----------|------|----------|----------|-------------|-------|
| ERROR | Semgrep | `use-defused-xml-parse` (13×) | translators.py, coverage_report.py, lint_project.py, project_edit.py, render_doc.py, test_results_report.py | Accepted risk | Same sites as Bandit B314 — parses trusted local XML files. See §6.1. |
| WARNING | Semgrep | `direct-use-of-jinja2` (2×) | render_doc.py:1380, :1389 | Accepted risk | Same as Bandit B701 — Markdown output, no browser XSS vector. |
| WARNING | Semgrep | `path-join-resolve-traversal` (16×) | prepackage.js, initProject.ts, quickFixes.ts, scaffoldTools.ts, MergeConflictResolver.ts, documents.ts, paths.ts | Accepted risk | All paths are rooted at the VS Code workspace folder. No user-controlled path segments from untrusted sources. |
| WARNING | Semgrep | `detect-non-literal-regexp` (11×) | fixes.ts, coverageLensLogic.ts, locator.ts | Accepted risk | Same as ESLint `detect-non-literal-regexp` — schema-derived patterns. |

## 7. Dependency Security

| Ecosystem | Scanner | Critical | High | Medium | Low |
|-----------|---------|----------|------|--------|-----|
| Python (pip) | pip-audit | 0 | 0 | 0 | 0 |
| Node.js (npm) | npm audit | 0 | 4 | 4 | 0 |

**pip-audit:** 0 vulnerabilities across 93 packages — clean.

**npm audit:** 8 vulnerabilities in transitive dependencies (all have
fixes available via `npm audit fix`):
- **High (4):** fast-uri (path traversal), mocha → serialize-javascript
  (RCE via RegExp.flags), serialize-javascript (same), undici
  (insufficiently random values).
- **Moderate (4):** @vscode/vsce → xml2js (prototype pollution),
  cheerio → undici, esbuild (dev server request leak), xml2js
  (prototype pollution).

All high/moderate npm findings are in **dev-only or build-only**
transitive dependencies (mocha, esbuild, @vscode/vsce, cheerio) —
none are shipped in the packaged `.vsix`. See [VR.md](VR.md) for
individual disposition.

## 8. Input Validation & Injection Surfaces

| Entry Point | Input Source | Validation | Notes |
|-------------|-------------|------------|-------|
| `Project.xml` parsing | Local file (user-authored) | XSD validation via `project.xsd`; `lint_project.py` checks structural constraints | Adequate — trusted local input |
| AI model responses | LLM via `vscode.lm.*` | JSON Schema validation (Draft-07); `apply_edit` revalidates against XSD before writing | Adequate — untrusted input validated before use |
| Git merge blobs | Local git repo | Parsed as XML; three-way merge validates output against XSD | Adequate — local trusted repo |
| Jinja2 templates | Bundled `.j2` files | Templates are static assets bundled with the extension; no user-supplied templates | Adequate — not an injection surface |
| `xmllint` subprocess | Fixed executable + workspace paths | Hardcoded command; paths from `vscode.workspace.workspaceFolders` | Adequate — no user-controlled arguments |

## 9. Secrets & Credential Hygiene

- No hardcoded secrets found in the repository (confirmed by Bandit
  and Semgrep scans).
- The only credential is the VS Code Marketplace PAT (`VSCE_PAT`),
  stored as a GitHub Actions secret — never referenced in source code.
- No `.env` files are committed. `.gitignore` excludes `.env` and
  `.edit_doc/`.
- AI grounding bundles sent to the LLM are scoped to `Project.xml`
  content and gated by `projectXml.ai.contextAllowList` + trusted
  workspace check.

## 10. Recommendations

| Priority | Recommendation | Component | Expected Outcome |
|----------|---------------|-----------|-----------------|
| Low | Fix ESLint `no-useless-escape` error in `formLogic.ts:412` | VS Code extension | Zero ESLint errors; CI gate passes cleanly |
| Low | Run `npm audit fix` to resolve transitive dependency vulnerabilities | VS Code extension | Reduce npm audit findings from 8 to 0 (all fixes available) |
| Info | Consider adding `defusedxml` for defence-in-depth, even though XML input is trusted | Python tools | Silences Bandit B314/B405 and Semgrep `use-defused-xml-parse` without changing behaviour |
| Info | Install Semgrep in local dev environment for full local scan coverage | Dev toolchain | Local results match CI |

## 11. Residual Risk Summary

**Overall posture: Low risk.**

All SAST findings are accepted risks with documented justification —
the tool operates on trusted local files in a desktop environment
with no network attack surface. The one actionable ESLint error
(`no-useless-escape`) is cosmetic. npm dependency vulnerabilities are
in dev/build-only transitive packages not shipped to end users.

**Assumptions:**
- Users run the extension in a trusted VS Code workspace.
- `Project.xml` files are authored by the developer, not received
  from untrusted external sources.
- AI model responses are always validated against JSON Schema and XSD
  before being applied; the user reviews diffs before accepting.

**Re-audit triggers:**
- Any change to the trust model (e.g. network-facing components,
  processing untrusted XML from external sources).
- Major dependency upgrades or new runtime dependencies.
- Addition of new input surfaces (web endpoints, plugin APIs).

## 12. Approval

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Author | AI-assisted (PR prompt) | 2026-05-10 | |
| Reviewer | | | |
