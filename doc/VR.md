# Vulnerability Report: TraceR (tracer)

**Version:** 0.4
**Date:** 2026-06-02
**Author(s):** AI-assisted (via PR prompt)

> **How to use this template.** This is a living document — update it
> as vulnerabilities are discovered, mitigated, or accepted. Each
> entry should be kept current with its latest status. Replace every
> `<placeholder>` and the prompt blocks with your own content. Delete
> prompts once a section is filled in.

## 1. Purpose

This Vulnerability Report (VR) tracks all known security
vulnerabilities in TraceR and its dependencies. It serves
as the canonical inventory of:

- Vulnerabilities discovered by automated scanners (Dependabot,
  npm audit, pip-audit, Bandit, ESLint, Semgrep)
- Vulnerabilities identified during manual review or penetration
  testing
- The disposition of each (fixed, mitigated, accepted, dismissed)

For the broader security assessment, see the companion
[Security Audit Report](SAR.md).

## 2. Summary

| Severity | Open | Mitigated | Accepted | Dismissed | Fixed |
|----------|------|-----------|----------|-----------|-------|
| Critical | 0 | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 0 | 4 | 0 |
| Medium | 0 | 0 | 2 | 8 | 0 |
| Low | 0 | 0 | 0 | 1 | 0 |

**Trend:** No open Dependabot alerts. Three new Dependabot alerts
(#18 `tmp` high, #17 `qs` moderate, #16 `uuid` moderate) were
triaged and dismissed on 2026-06-02. `npm audit fix` on 2026-06-02
upgraded transitive devDeps (`tmp`, `brace-expansion`, `qs`, `uuid`,
`ws`) — npm audit now reports 0 vulnerabilities. pip-audit not run this
cycle (not installed in `.venv`); Phase 13 baseline was clean. SAST
findings are assessed in [SAR.md](SAR.md) §6 — all accepted risks
with justification (trusted local input context).

**Last updated:** 2026-06-02

## 3. Scanning Configuration

| Scanner | Ecosystem | Frequency | Alert Destination |
|---------|-----------|-----------|-------------------|
| Dependabot | npm | Daily | GitHub Security tab |
| Bandit | Python | CI on every PR | CI logs + PR comment + GitHub Step Summary |
| pip-audit | Python | CI on every PR | CI logs + PR comment + GitHub Step Summary |
| ESLint + eslint-plugin-security | TypeScript | CI on every PR | CI logs + PR comment + GitHub Step Summary |
| npm audit | npm | CI on every PR | CI logs + PR comment + GitHub Step Summary |
| Semgrep (OWASP community rules) | Python + TypeScript | CI on every PR | CI logs + PR comment + GitHub Step Summary |

## 4. Open Vulnerabilities

No open vulnerabilities as of 2026-06-02.

### 4.1 Critical

| CVE / ID | Component | Version | Description | Planned Action | Target Date |
|----------|-----------|---------|-------------|----------------|-------------|
| — | — | — | No open critical vulnerabilities. | — | — |

### 4.2 High

| CVE / ID | Component | Version | Description | Planned Action | Target Date |
|----------|-----------|---------|-------------|----------------|-------------|
| — | — | — | No open high-severity vulnerabilities. | — | — |

### 4.3 Medium

| CVE / ID | Component | Version | Description | Planned Action | Target Date |
|----------|-----------|---------|-------------|----------------|-------------|
| — | — | — | No open medium-severity vulnerabilities. | — | — |

### 4.4 Low

| CVE / ID | Component | Version | Description | Planned Action | Target Date |
|----------|-----------|---------|-------------|----------------|-------------|
| — | — | — | No open low-severity vulnerabilities. | — | — |

## 5. Accepted Risks

No dependency vulnerabilities accepted as open risks. All SAST
accepted risks are documented in [SAR.md](SAR.md) §6 (static
analysis findings with "Accepted risk" disposition).

| CVE / ID | Component | Severity | Justification | Approved By | Re-evaluate |
|----------|-----------|----------|---------------|-------------|-------------|
| — | — | — | No accepted dependency risks. | — | — |

## 6. Dismissed Vulnerabilities

13 total Dependabot alerts dismissed: 10 on 2026-05-10, plus 3 new
alerts (#18 `tmp`, #17 `qs`, #16 `uuid`) dismissed on 2026-06-02.
All are transitive devDependencies not shipped in the packaged `.vsix`.

| CVE / ID | Component | Severity | Reason for Dismissal |
|----------|-----------|----------|---------------------|
| GHSA-ph9p-34f9-6g65 (#18) | tmp (npm) | High | Transitive devDep via `vscode-extension-tester`. Path Traversal only reachable in test tooling. Not shipped in .vsix. (`not_used`) — dismissed 2026-06-02 |
| GHSA-q8mj-m7cp-5q26 (#17) | qs (npm) | Moderate | Transitive devDep. `qs.stringify` DoS not reachable in production code. Not shipped in .vsix. (`not_used`) — dismissed 2026-06-02 |
| GHSA-w5hq-g745-h8pq (#16) | uuid (npm) | Moderate | Transitive devDep via `@azure/msal-node` → `vscode-extension-tester`. Buffer bounds issue only in test tooling. Not shipped in .vsix. (`not_used`) — dismissed 2026-06-02 |
| CVE-2026-6322 | fast-uri (npm) | High | Transitive devDep via ajv/@rjsf. Not shipped in .vsix. No URI parsing of untrusted input at runtime. (`not_used`) |
| CVE-2026-6321 | fast-uri (npm) | High | Transitive devDep via ajv/@rjsf. Not shipped in .vsix. No URI parsing of untrusted input at runtime. (`not_used`) |
| GHSA (no CVE) | serialize-javascript (npm) | High | Transitive devDep via mocha (test framework). Not shipped in .vsix. (`not_used`) |
| CVE-2026-1527 | undici (npm) | Medium | Override pin for transitive devDep. Extension makes no HTTP requests via undici. Pulled in by cheerio/vsce (dev tools). Not shipped. (`not_used`) |
| CVE-2026-1525 | undici (npm) | Medium | Transitive devDep via cheerio/vsce. Extension makes no HTTP requests via undici. Not shipped. (`not_used`) |
| CVE-2025-22150 | undici (npm) | Medium | Transitive devDep. Extension makes no HTTP requests via undici. Not shipped in .vsix. (`not_used`) |
| CVE-2023-0842 | xml2js (npm) | Medium | Transitive devDep via @vscode/vsce (packaging tool). No XML parsing of untrusted input. Not shipped. (`not_used`) |
| CVE-2026-34043 | serialize-javascript (npm) | Medium | Transitive devDep via mocha (test framework). Not shipped in .vsix. (`not_used`) |
| GHSA (no CVE) | esbuild (npm) | Medium | Direct devDep (bundler). Vulnerability is in esbuild's dev server which is not run in production. Risk limited to local dev environments. (`tolerable_risk`) |
| CVE-2025-47279 | undici (npm) | Low | Transitive devDep. Extension makes no HTTP requests via undici. Not shipped. (`not_used`) |

## 7. Resolved Vulnerabilities (History)

| CVE / ID | Component | Severity | Resolution | Date Fixed |
|----------|-----------|----------|-----------|------------|
| GHSA-ph9p-34f9-6g65 | tmp (npm) | High | Resolved via `npm audit fix` upgrading transitive devDeps; no longer present in npm audit. | 2026-06-02 |
| GHSA-jxxr-4gwj-5jf2 | brace-expansion (npm) | Moderate | Resolved via `npm audit fix`; no longer present in npm audit. | 2026-06-02 |
| GHSA-q8mj-m7cp-5q26 | qs (npm) | Moderate | Resolved via `npm audit fix`; no longer present in npm audit. | 2026-06-02 |
| GHSA-w5hq-g745-h8pq | uuid (npm) | Moderate | Resolved via `npm audit fix`; no longer present in npm audit. | 2026-06-02 |
| GHSA-58qx-3vcg-4xpx | ws (npm) | Moderate | Resolved via `npm audit fix`; no longer present in npm audit. | 2026-06-02 |
| CVE-2026-6322 | fast-uri (npm) | High | Resolved via transitive upgrade through ajv/@rjsf; no longer present in npm audit. | 2026-05-16 |
| CVE-2026-6321 | fast-uri (npm) | High | Resolved via transitive upgrade through ajv/@rjsf; no longer present in npm audit. | 2026-05-16 |
| GHSA serialize-javascript | serialize-javascript (npm) | High | Resolved via `serialize-javascript: 7.0.5` override in extension `package.json`. | 2026-05-16 |
| CVE-2026-1527 | undici (npm) | Medium | Resolved via `undici: ^6.21.1` override pinning in extension `package.json`. | 2026-05-16 |
| CVE-2026-1525 | undici (npm) | Medium | Resolved via `undici: ^6.21.1` override pinning. | 2026-05-16 |
| CVE-2025-22150 | undici (npm) | Medium | Resolved via `undici: ^6.21.1` override pinning. | 2026-05-16 |
| CVE-2023-0842 | xml2js (npm) | Medium | Resolved via @vscode/vsce transitive upgrade; no longer present in npm audit. | 2026-05-16 |
| CVE-2026-34043 | serialize-javascript (npm) | Medium | Resolved via override (see High row above). | 2026-05-16 |
| GHSA esbuild | esbuild (npm) | Medium | Resolved via esbuild upgrade in extension dev dependencies. | 2026-05-16 |
| CVE-2025-47279 | undici (npm) | Low | Resolved via `undici: ^6.21.1` override pinning. | 2026-05-16 |

## 8. Process

New vulnerabilities are triaged during each pull request using the
PR prompt workflow (`.github/prompts/PR.prompt.md`), which runs
static analysis, fetches Dependabot alerts, and updates this report.

| Severity | Response SLA | Remediation SLA | Owner |
|----------|-------------|-----------------|-------|
| Critical | 24 hours | 7 days | Project maintainer |
| High | 48 hours | 30 days | Project maintainer |
| Medium | 1 week | 90 days | Project maintainer |
| Low | 2 weeks | Next release | Project maintainer |
