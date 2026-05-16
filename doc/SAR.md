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
| A06 | Vulnerable/Outdated Components | Applicable | Mitigated | npm audit reports 0 vulnerabilities after Phase 13/14 dependency updates (undici override pinned to `^6.21.1`). pip-audit clean. See §7 and [VR.md](VR.md). |
| A07 | Identification/Authentication Failures | N/A | N/A | No user authentication. AI model access delegated to VS Code Copilot auth. |
| A08 | Software/Data Integrity Failures | N/A | Mitigated | Extension bundled via esbuild; `.vsix` published through CI with a gated PAT. AI edits require user approval (no auto-apply). |
| A09 | Security Logging/Monitoring Failures | N/A | N/A | Local tool — no runtime logging requirements. AI provenance logged to `.edit_doc/ai_history.jsonl`. |
| A10 | Server-Side Request Forgery | N/A | N/A | No server-side components; no outbound requests except via VS Code's LLM API (user-initiated). |

## 6. Static Analysis Findings

Automated SAST was last run on 2026-05-16 using Bandit, ESLint + eslint-plugin-security, and Semgrep. Findings are categorised below with dispositions. The summary table reflects the current scan; previously-reported HIGH/MEDIUM Bandit findings (B701 Jinja2, B314 ElementTree, B405 import) were resolved during Phase 13 via `defusedxml` and Jinja2 autoescape configuration.

### 6.1 Bandit — Python Security (7 findings: 0 high, 0 medium, 7 low)

| Severity | Tool | Rule/CWE | Location | Disposition | Notes |
|----------|------|----------|----------|-------------|-------|
| LOW | Bandit | B404 (subprocess import) | lint_project.py:42; render_doc.py:1362 | Accepted risk | `subprocess` is used to invoke `xmllint` with fixed arguments for XSD validation. No user-controlled input reaches the command line. |
| LOW | Bandit | B603 (subprocess call) | lint_project.py:203; render_doc.py:1375 | Accepted risk | Invokes `xmllint` with a hardcoded executable name and file paths derived from the workspace (not user-supplied strings from untrusted sources). |
| LOW | Bandit | B607 (partial executable path) | lint_project.py:203 | Accepted risk | Companion to B603 above — `xmllint` resolved via PATH on the developer's machine. |
| LOW | Bandit | B101 (assert) | project_edit.py:409, :420 | Accepted risk | Assertions guard internal invariants in edit logic; these are developer-facing tools, not production services where `-O` stripping is a concern. |

### 6.2 ESLint — TypeScript Security + Quality (0 errors, 48 warnings)

| Severity | Tool | Rule/CWE | Location | Disposition | Notes |
|----------|------|----------|----------|-------------|-------|
| warning | ESLint | `security/detect-object-injection` (15×) | capabilities.ts, treeMenu.ts, QuickFixProvider.ts, coverageLensLogic.ts, lintMapping.ts, formLogic.ts, formMain.tsx, treeLogic.ts, freshness.ts, locator.ts | Accepted risk | All flagged sites use string keys from schema-defined enums or parsed JSON-RPC responses, not arbitrary user input. Object injection is not exploitable. |
| warning | ESLint | `security/detect-non-literal-fs-filename` (20×) | initProject.ts, scaffoldTools.ts, sidecar.ts, freshness.ts, paths.ts, MergeConflictResolver.ts | Accepted risk | File paths are constructed from `vscode.workspace.workspaceFolders` and known subpaths — all within the trusted workspace boundary. |
| warning | ESLint | `security/detect-non-literal-regexp` (5×) | fixes.ts, coverageLensLogic.ts, locator.ts | Accepted risk | Regex patterns are built from schema-derived element names and id attributes, not arbitrary user input. |
| warning | ESLint | `security/detect-unsafe-regex` (2×) | fixes.ts:95, locator.ts:182 | Accepted risk | Patterns match fixed XML id/tag formats with bounded repetition; ReDoS is not feasible on the input domain. |

The previously-reported `no-useless-escape` error in `formLogic.ts:412` was fixed during Phase 13 — ESLint now reports zero errors.

### 6.3 Semgrep — OWASP (31 findings)

| Severity | Tool | Rule/CWE | Location | Disposition | Notes |
|----------|------|----------|----------|-------------|-------|
| WARNING | Semgrep | `direct-use-of-jinja2` (2×) | render_doc.py:1380, :1390 | Accepted risk | Markdown output, no browser XSS vector. Autoescape configured for HTML/XML extensions in Phase 13. |
| WARNING | Semgrep | `path-join-resolve-traversal` (20×) | prepackage.js, initProject.ts, quickFixes.ts, scaffoldTools.ts, MergeConflictResolver.ts, documents.ts, paths.ts | Accepted risk | All paths are rooted at the VS Code workspace folder. No user-controlled path segments from untrusted sources. |
| WARNING | Semgrep | `detect-non-literal-regexp` (9×) | fixes.ts, coverageLensLogic.ts, locator.ts | Accepted risk | Same as ESLint `detect-non-literal-regexp` — schema-derived patterns. |

The previously-reported `use-defused-xml-parse` ERROR findings (13×) were resolved during Phase 13 by switching XML parsing call sites to `defusedxml.ElementTree`.

## 7. Dependency Security

| Ecosystem | Scanner | Critical | High | Medium | Low |
|-----------|---------|----------|------|--------|-----|
| Python (pip) | pip-audit | 0 | 0 | 0 | 0 |
| Node.js (npm) | npm audit | 0 | 0 | 0 | 0 |

**pip-audit:** 0 vulnerabilities across 93 packages — clean.

**npm audit:** 0 vulnerabilities — clean. The previous 8 transitive
high/moderate findings (fast-uri, serialize-javascript, undici,
xml2js, esbuild) were resolved by Phase 13 dependency updates and
the Phase 14 pinning of the `undici` override to `^6.21.1`. The
affected packages remain dev-/build-only and are not shipped in the
packaged `.vsix`. See [VR.md](VR.md) §7 for the resolution history.

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
| Info | Continue running `make -C tools analyze` on every PR (already wired into CI) | Dev toolchain | Regressions in finding counts caught at PR time |
| Info | Re-evaluate `defusedxml` adoption if any new XML parsing call sites are added | Python tools | Maintain Semgrep `use-defused-xml-parse` clean baseline |
| Info | Install Semgrep in local dev environment for full local scan coverage | Dev toolchain | Local results match CI |

## 11. Residual Risk Summary

**Overall posture: Low risk.**

All remaining SAST findings are accepted risks with documented
justification — the tool operates on trusted local files in a
desktop environment with no network attack surface. Phase 13
resolved every HIGH/MEDIUM Bandit finding (via `defusedxml` and
Jinja2 autoescape), the previously-flagged ESLint error
(`no-useless-escape`), and the Semgrep `use-defused-xml-parse`
ERROR set. Phase 14's dependency-tree refresh brings npm audit to
zero. There are currently no Open findings.

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
| Author | AI-assisted (PR prompt) | 2026-05-16 | |
| Reviewer | | | |
