---
description: "Prepare a release: bump VERSION, triage Dependabot alerts, update vulnerability report, commit, push, and open a release PR"
mode: "agent"
tools: [execute, read, search, editFiles]
---
You prepare release branches for any repository that uses TraceR
(`doc/Project.xml`) as its specification source of truth. This prompt is
generic — it works regardless of the product domain, language, or framework.

Perform the following steps in order. Stop and report if any step fails.

## 0. Discover project layout

- Locate the `VERSION` file (root of workspace, or search for it).
- Locate `doc/VR.md` (Vulnerability Report) if it exists.
- Determine the default branch (`develop`, `main`, or remote default).

## 1. Display current version and prompt for new version

- Determine the current version from (in priority order):
  1. The `VERSION` file in the workspace root (if it exists).
  2. The most recent git tag matching a semver pattern:
     `git tag --sort=-v:refname | grep -E '^v?[0-9]+\.[0-9]+' | head -5`.
  3. Version fields in `package.json`, `pyproject.toml`, `setup.cfg`, or
     `Cargo.toml` (if present).
  4. If none found, report "No existing version detected" and note this is
     the first release.
- Display the current version (or lack thereof) to the user.
- Ask the user for the new version number (e.g. `1.2.0`).

## 2. Create release branch

- Ensure the working tree is clean (`git status --porcelain`). If not, ask
  the user whether to stash or abort.
- Create and switch to a new branch: `git checkout -b release/<new-version>`

## 3. Update VERSION file

- If a `VERSION` file exists, overwrite its contents with the new version
  string (just the version and a trailing newline).
- If no `VERSION` file exists, create one in the workspace root with the
  new version string.
- If the project has other version references (e.g. `package.json` version
  field, `pyproject.toml`, `setup.cfg`, `Cargo.toml`), update those as well
  to keep versions in sync.

## 4. Check Dependabot vulnerability alerts

- Run `gh api repos/{owner}/{repo}/dependabot/alerts --jq '.[] | select(.state=="open")'`
  to list open Dependabot alerts.
- If `gh` is not available or not authenticated, note this and skip to step 5.
- For each open alert, assess whether it can be dismissed:
  - **Dismissible** (not exploitable in this context, dev-only dependency,
    test-only dependency, or already mitigated by other controls): dismiss
    with justification using
    `gh api -X PATCH repos/{owner}/{repo}/dependabot/alerts/{number} -f state=dismissed -f dismissed_reason=<reason> -f dismissed_comment="<justification>"`.
    Valid reasons: `fix_started`, `inaccurate`, `no_bandwidth`, `not_used`,
    `tolerable_risk`.
  - **Not dismissible** (genuine risk, needs upgrade or mitigation): leave
    open and note for the vulnerability report.
- Present the triage decisions to the user for approval before dismissing.

## 5. Update Vulnerability Report (doc/VR.md) — if it exists

- If `doc/VR.md` exists and there are alerts that could not be dismissed:
  - Add new entries to §4 (Open Vulnerabilities) with CVE, component,
    severity, description, and planned action.
  - Update the §2 Summary counts.
  - Move any alerts that were dismissed to §6 (Dismissed Vulnerabilities)
    with the justification.
- If `doc/VR.md` does not exist, note in the summary that vulnerability
  tracking should be set up (suggest running
  `python3 tools/render_doc.py --generate-doc VR`).

## 6. Generate commit message

Create a commit message following this format:

```
chore(release): prepare release <new-version>

- Bump VERSION to <new-version>
- Triage Dependabot alerts: <n> dismissed, <m> remain open
- Update vulnerability report (if applicable)
```

Present the proposed commit message to the user for approval.

## 7. Commit and push

- Stage all changes: `git add -A`
- Commit with the approved message.
- Push the branch: `git push -u origin release/<new-version>`

## 8. Create Pull Request

- Use the GitHub CLI to create a PR:
  ```
  gh pr create --base <default-branch> --head release/<new-version> \
      --title "Release <new-version>" --body "<body>"
  ```
- The PR body should include:
  - Version bump summary
  - Dependabot triage summary (dismissed count, open count, justifications)
  - Vulnerability report update status
  - Checklist: `- [x] VERSION updated`, `- [x] Alerts triaged`,
    `- [x] VR.md updated` (as applicable)
- If `gh` CLI is not available, stop after the push and provide the URL to
  create the PR manually.

## Constraints

- Do NOT force-push.
- Do NOT merge the PR — only create it.
- Do NOT create a GitHub Release — that is a separate step after the PR is
  merged.
- Do NOT dismiss Dependabot alerts without presenting justifications to the
  user for approval first.
- Do NOT assume fixed paths — discover them from the workspace structure.
- If the VERSION file does not exist, create one in the workspace root with
  the new version string. If other version sources exist (git tags,
  `package.json`, `pyproject.toml`), derive the current version from those
  and note in the summary that a VERSION file was created.
- If `gh` CLI is not available, perform all local steps and provide manual
  instructions for the remaining GitHub operations.
