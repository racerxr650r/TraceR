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
- Locate the tools directory containing `lint_project.py` and `render_doc.py`
  (typically `tools/`).

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

## 3. Generate a commit message

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

## 4. Commit

- Stage all remaining changes: `git add -A`
- Commit with the approved message: `git commit -m "<message>"`

## 5. Push

- Push the branch: `git push -u origin <branch-name>`

## 6. Create Pull Request

- Use the GitHub CLI to create a PR:
  ```
  gh pr create --base <base-branch> --head <branch-name> --title "<short summary>" --body "<body>"
  ```
- The PR title should match the commit's short summary.
- The PR body should include:
  - A summary of changes (from the commit body)
  - A checklist of what was done (e.g. `- [x] SDP updated`,
    `- [x] Tests pass`, `- [x] Lint clean`)
  - `Closes #<issue>` if applicable

## Constraints

- Do NOT force-push.
- Do NOT merge the PR — only create it.
- Do NOT modify source code — only hand-authored doc files (SDP.md, etc.)
  may be edited.
- Do NOT assume fixed paths — discover them from the workspace structure.
- If `gh` CLI is not installed or not authenticated, stop after the push and
  provide the URL to create the PR manually.
- If there are uncommitted changes when starting, ask the user whether to
  include them or stash them first.
- If the SDP or other hand-authored docs do not exist, skip updates to them
  and note the absence in the PR body.
