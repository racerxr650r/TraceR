# Vulnerability Report: TraceR (tracer)

**Version:** 0.2
**Date:** 2026-05-10
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
| High | 0 | 0 | 0 | 3 | 0 |
| Medium | 0 | 0 | 0 | 6 | 0 |
| Low | 0 | 0 | 0 | 1 | 0 |

**Trend:** First baseline assessment — all 10 Dependabot alerts
dismissed as dev-only/build-only dependencies not shipped in the
`.vsix`. SAST findings assessed in [SAR.md](SAR.md) §6 — all
accepted risks with justification (trusted local input context).

**Last updated:** 2026-05-10

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

No open vulnerabilities as of 2026-05-10.

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

All 10 Dependabot alerts dismissed on 2026-05-10. All are in
dev-only or build-only npm transitive dependencies not shipped in
the packaged `.vsix`.

| CVE / ID | Component | Severity | Reason for Dismissal |
|----------|-----------|----------|---------------------|
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
| — | — | — | No resolved vulnerabilities yet (first baseline). | — |

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
