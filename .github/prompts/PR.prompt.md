---
description: "Commit, push, and open a pull request for the current branch with release-note-quality commit message"
mode: "agent"
tools: [execute, read, search, editFiles]
---
You prepare and submit pull requests for any repository that uses TraceR
(`doc/Project.xml`) as its specification source of truth. This prompt is
generic — it works regardless of the product domain, language, or framework.

Perform the following steps in order. Stop and report if any step fails.

## 0. Discover project layout

- Locate `doc/Project.xml` (or the path configured in the workspace).
- Identify which hand-authored documents exist under `doc/` (SDP.md, SAR.md,
  VR.md, PVD.md — any or all may be absent; only update those that exist).
- Locate the tools directory containing `lint_project.py`, `render_doc.py`,
  and `analyze_report.py` (typically `tools/`).
- Locate the Makefile (typically `tools/Makefile`) — it contains the
  `analyze` and `analyze_report` targets used for static analysis.

## 1. Gather context

- Read the current branch name (`git branch --show-current`).
- Determine the base branch. Check for `develop`, then `main`, then the
  remote default (`git symbolic-ref refs/remotes/origin/HEAD`). Confirm by
  checking the upstream tracking branch if set.
- Collect the diff summary: `git diff --stat <base>..HEAD` and
  `git log --oneline <base>..HEAD`.

## 2. Update doc/SDP.md — Status and Phased Delivery (if SDP exists)

- Read `doc/SDP.md` and locate the **Status** table and the **Phased
  Delivery** section.
- Based on the work done on this branch (from the diff and commit log),
  update the status of the relevant phase(s):
  - Mark phases as ✅ Complete / ✅ Done (with a brief summary) if all
    acceptance criteria are met.
  - Update in-progress phases with a concise description of what was
    delivered.
- Ensure the Status table and the phase descriptions are consistent.
- Stage the changes: `git add doc/SDP.md`.
- If `doc/SDP.md` does not exist, skip this step.

## 3. Run static analysis and update doc/SAR.md (if SAR exists)

- Check whether the project's Makefile has an `analyze` target:
  ```
  grep -n '^analyze' tools/Makefile 2>/dev/null
  ```
  If it does, run the full static analysis suite:
  ```
  make -C tools analyze
  ```
  This produces reports under `test_reports/` (check the Makefile for the
  exact output location and which tools are configured for this project).
  If the project uses a different mechanism (a CI script, `tox`, a
  `scripts/lint.sh`, etc.), adapt accordingly.
- Read the generated analysis report. For TraceR-scaffolded projects the
  consolidated report is `test_reports/analyze-report.md`.

- **Check the CI error gate before accepting any findings.**
  If the project has an `analyze-check-errors` target, run:
  ```
  make -C tools analyze-check-errors
  ```
  This enforces the same thresholds as CI. If it exits non-zero, the
  blocking findings **must be fixed** (not merely accepted) before
  proceeding. Inspect the project's `tools/analyze_report.py` (or
  equivalent gate script) to see the exact thresholds — common blocking
  criteria are:
  - SAST findings at **HIGH** severity or above
  - Linter **errors** (warnings are typically non-blocking)
  - Dependency audit findings at **critical** or **high** severity
  For dependency audit HIGH/critical findings in dev-only or transitive
  deps, try the tool's automatic fix command first (e.g. `npm audit fix`,
  `pip-audit --fix`) — this often resolves CVEs without changing direct
  dependency versions. Update any lockfiles and re-run before committing.
- If `doc/SAR.md` exists, update it:
  - **§6 Static Analysis Findings** — Replace the findings table with the
    current results. For each finding, set a disposition:
    - **Fixed**: if the finding was resolved in this branch's changes.
    - **Accepted risk**: if the finding is a known acceptable pattern
      (e.g. `xml.etree.ElementTree` used on trusted project files, not
      untrusted input). Include brief justification. Note: "Accepted risk"
      is only valid for findings that do NOT trigger the CI gate above.
    - **False positive**: if the tool flagged something incorrectly.
    - **Open**: if it genuinely needs remediation.
  - **§7 Dependency Security** — Update the summary counts from the
    pip-audit and npm audit sections of the report.
  - **§5 OWASP Top 10** — If any findings affect the OWASP assessment,
    update the relevant rows.
- Stage the changes: `git add doc/SAR.md`.
- If `doc/SAR.md` does not exist, skip this step.

## 4. Triage Dependabot alerts on GitHub

- If `gh` CLI is available and authenticated, retrieve open Dependabot
  alerts:
  ```
  gh api repos/{owner}/{repo}/dependabot/alerts --jq '.[] | select(.state=="open")'
  ```
- For each open alert, determine applicability:
  - **Is it a direct dependency or transitive?** Check if the vulnerable
    package appears in the project's direct `requirements.txt` /
    `pyproject.toml` or `package.json` dependencies.
  - **Is the vulnerable code path reachable?** Consider how the project
    uses the dependency — dev-only, test-only, build-only, or runtime.
  - **Is it already mitigated** by other controls (input validation,
    sandboxing, network isolation)?
- Categorise each alert:
  - **Dismiss** (with justification) if: not exploitable in context,
    dev/test-only dependency, or already mitigated. Use:
    ```
    gh api -X PATCH repos/{owner}/{repo}/dependabot/alerts/{number} \
        -f state=dismissed \
        -f dismissed_reason=<reason> \
        -f dismissed_comment="<justification>"
    ```
    Valid reasons: `fix_started`, `inaccurate`, `no_bandwidth`,
    `not_used`, `tolerable_risk`.
  - **Leave open** if it represents genuine risk requiring upgrade or
    mitigation.
- Present the triage decisions to the user for approval before
  dismissing any alerts.
- If `gh` is not available, note the skip and advise manual triage.

## 5. Update doc/VR.md — Vulnerability Report (if VR exists)

- If `doc/VR.md` exists, update it using data from both the static
  analysis report and the Dependabot triage:
  - **§2 Summary** — Update the severity counts table to reflect current
    state (open, mitigated, accepted, dismissed, fixed) across all
    sources.
  - **§3 Scanning Configuration** — Ensure the table lists all active
    scanners (Dependabot, pip-audit, npm audit, Bandit, ESLint, Semgrep)
    with correct frequencies (e.g. "CI on every PR" for the static
    analysis tools, "Daily" for Dependabot).
  - **§4 Open Vulnerabilities** — Add entries for Dependabot alerts left
    open and any static analysis findings marked "Open", sorted by
    severity into the subsections (§4.1 Critical, §4.2 High, etc.).
  - **§5 Accepted Risks** — Add entries for findings deliberately
    accepted (from both SAR dispositions and Dependabot triage), with
    justification.
  - **§6 Dismissed Vulnerabilities** — Add entries for Dependabot alerts
    dismissed and static analysis findings marked "False positive" or
    "Not applicable", with the reason.
  - **§7 Resolved Vulnerabilities** — Move any previously-open entries
    that are now fixed (check if CVEs from the prior version of VR.md
    are still present in the current scan results).
- Stage the changes: `git add doc/VR.md`.
- If `doc/VR.md` does not exist, note its absence and suggest running
  `python3 tools/render_doc.py --generate-doc VR` to scaffold it.

## 6. Generate a commit message

Create a commit message following this format:

```
<type>(<scope>): <short summary>

<body — bullet list of notable changes, suitable for release notes>

Closes #<issue> (if the branch name contains an issue number)
```

Where:
- `<type>` is one of: `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `chore`
- `<scope>` is the affected area (e.g. `sdp`, `extension`, `ai`, `schema`,
  `tools`, or a project-specific scope)
- The body should list user-visible changes in bullet form — these become
  release notes
- Extract the issue number from the branch name if it starts with a number
  (e.g. `29-phase-9...` → `#29`)

Present the proposed commit message to the user for approval before committing.

## 7. Commit

- Stage all remaining changes: `git add -A`
- Commit with the approved message: `git commit -m "<message>"`

## 8. Push

- Push the branch: `git push -u origin <branch-name>`

## 9. Create Pull Request

- Use the GitHub CLI to create a PR:
  ```
  gh pr create --base <base-branch> --head <branch-name> --title "<short summary>" --body "<body>"
  ```
- The PR title should match the commit's short summary.
- The PR body should include:
  - A summary of changes (from the commit body)
  - A checklist of what was done (e.g. `- [x] SDP updated`,
    `- [x] Static analysis run`, `- [x] SAR updated`,
    `- [x] Dependabot triaged`, `- [x] VR updated`,
    `- [x] Tests pass`, `- [x] Lint clean`)
  - `Closes #<issue>` if applicable

## Constraints

- Do NOT force-push.
- Do NOT merge the PR — only create it.
- Do NOT modify source code — only hand-authored doc files (SDP.md, SAR.md,
  VR.md, etc.) may be edited.
- Do NOT assume fixed paths — discover them from the workspace structure.
- If `gh` CLI is not installed or not authenticated, stop after the push and
  provide the URL to create the PR manually.
- If there are uncommitted changes when starting, ask the user whether to
  include them or stash them first.
- If the SDP, SAR, VR, or other hand-authored docs do not exist, skip
  updates to them and note the absence in the PR body.
- Static analysis findings in the SAR should be assessed for disposition —
  do not blindly list every finding as "Open".
- When dismissing Dependabot alerts, always present decisions to the user
  for approval first. Never auto-dismiss without confirmation.
