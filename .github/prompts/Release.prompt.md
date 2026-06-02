---
description: "Prepare and publish a release: create release branch, bump VERSION, triage Dependabot, open PR, wait for CI, tag, publish GitHub Release, and merge"
mode: "agent"
tools: [execute, read, search, editFiles]
---
You prepare and publish releases for any repository that uses TraceR
(`doc/Project.xml`) as its specification source of truth. This prompt is
generic — it works regardless of the product domain, language, or framework.

Perform the following steps in order. Stop and report if any step fails.

## 0. Discover project layout

- Locate the `VERSION` file (workspace root, or search for it).
- Locate `doc/VR.md` (Vulnerability Report) if it exists.
- Determine the integration branch (check for `develop`, then `main`, then
  `git symbolic-ref refs/remotes/origin/HEAD`). This is the branch the
  release PR will target and merge into.

## 1. Determine current version and ask for new version

- Determine the current version from (in priority order):
  1. The `VERSION` file in the workspace root.
  2. The most recent git tag matching a semver pattern:
     `git tag --sort=-v:refname | grep -E '^v?[0-9]+\.[0-9]+' | head -5`
  3. Version fields in `package.json`, `pyproject.toml`, `setup.cfg`, or
     `Cargo.toml` (if present).
  4. If none found, report "No existing version detected".
- Display the current version to the user.
- Ask the user for the new version number (e.g. `1.2.0`).
- Check that a tag `v<new-version>` does not already exist:
  `git tag -l "v<new-version>"`. If it exists, stop and inform the user.

## 2. Create the release branch

- Ensure the working tree is clean (`git status --porcelain`). If not,
  ask the user whether to stash or abort.
- Ensure you are on the integration branch and it is up to date:
  `git checkout <integration-branch> && git pull`
- Create and switch to the release branch:
  `git checkout -b release/<new-version>`

## 3. Bump VERSION and sync version references

- Overwrite `VERSION` with the new version string and a trailing newline.
- If the project has other version references (`package.json` `"version"`
  field, `pyproject.toml`, `setup.cfg`, `Cargo.toml`), update those as
  well to keep versions in sync.

## 4. Triage Dependabot vulnerability alerts

- If `gh` is available and authenticated, retrieve open alerts:
  ```
  gh api repos/{owner}/{repo}/dependabot/alerts \
      --jq '.[] | select(.state=="open")'
  ```
- For each open alert, assess dismissibility:
  - **Dismissible** (dev-only / test-only dependency, not exploitable in
    context, or already mitigated): dismiss with justification:
    ```
    gh api -X PATCH repos/{owner}/{repo}/dependabot/alerts/{number} \
        -f state=dismissed \
        -f dismissed_reason=<reason> \
        -f dismissed_comment="<justification>"
    ```
    Valid reasons: `fix_started`, `inaccurate`, `no_bandwidth`,
    `not_used`, `tolerable_risk`.
  - **Not dismissible** (genuine risk needing upgrade): leave open and
    note for the vulnerability report.
- Present triage decisions to the user for approval before dismissing.
- If `gh` is unavailable, note the skip.

## 5. Update doc/VR.md — Vulnerability Report (if it exists)

- If `doc/VR.md` exists:
  - Move dismissed alerts to §6 (Dismissed Vulnerabilities) with
    justification.
  - Add any non-dismissible alerts to §4 (Open Vulnerabilities).
  - Update §2 Summary counts.
- If `doc/VR.md` does not exist, suggest running
  `python3 tools/render_doc.py --generate-doc VR` to scaffold it.

## 6. Commit and push the release branch

Generate and present a commit message for user approval:

```
chore(release): prepare release <new-version>

- Bump VERSION to <new-version>
- Triage Dependabot alerts: <n> dismissed, <m> remain open
- Update vulnerability report (if applicable)
```

- Stage all changes: `git add -A`
- Commit with the approved message.
- Push the branch: `git push -u origin release/<new-version>`

## 7. Open a pull request and wait for CI

- Create a PR targeting the integration branch:
  ```
  gh pr create \
      --base <integration-branch> \
      --head release/<new-version> \
      --title "Release <new-version>" \
      --body "Automated release preparation for v<new-version>."
  ```
- Wait for all CI checks to complete:
  ```
  gh pr checks <pr-number> --watch
  ```
- If any check fails, stop and report the failure. Do NOT proceed to
  tagging or releasing. The user must fix the failure and re-run this
  prompt (or push a fix commit to the release branch and re-run from
  this step).

## 8. Generate release notes

- Identify the previous release tag:
  `git tag --sort=-v:refname | grep -E '^v?[0-9]+\.[0-9]+' | head -1`
- Collect commits since the previous tag:
  `git log --oneline <previous-tag>..HEAD`
- Organise commits by conventional commit prefix:
  - **Features** (`feat`), **Bug Fixes** (`fix`), **Documentation** (`docs`),
    **Refactoring** (`refactor`), **Tests** (`test`), **CI/CD** (`ci`),
    **Other** (everything else)
- Format as Markdown:
  ```
  ## What's Changed

  ### Features
  - <summary> (<short-sha>)
  ...

  **Full Changelog**: <previous-tag>...v<new-version>
  ```
- If no previous tag exists, include all commits.
- Present the release notes to the user for approval.

## 9. Tag and publish the GitHub Release

- Create an annotated tag from the release branch HEAD:
  ```
  git tag -a "v<new-version>" -m "Release <new-version>"
  git push origin "v<new-version>"
  ```
- Create the GitHub Release targeting the release branch:
  ```
  gh release create "v<new-version>" \
      --title "v<new-version>" \
      --notes "<release-notes>" \
      --target release/<new-version>
  ```
  This triggers any `on: release: types: [created]` CI workflow (e.g.
  the publish-vsix workflow) automatically.
- If `gh` is not available, stop after pushing the tag and provide
  manual instructions for creating the GitHub Release.

## 10. Merge the release branch into the integration branch

- Merge the release PR using a merge commit (preserves release branch
  history intact):
  ```
  gh pr merge <pr-number> --merge --auto
  ```
- If the merge fails due to a conflict, report the conflict and stop.
  The user must resolve it manually and re-run from this step.

## 11. Bump VERSION for the next development cycle

Only perform this step if steps 9 and 10 both succeeded.

- Check out the integration branch and pull:
  `git checkout <integration-branch> && git pull`
- Increment the **minor** version and reset patch to zero
  (e.g. `0.3.0` → `0.4.0`).
- Write the new version to `VERSION`.
- Commit and push:
  ```
  git commit -am "chore: bump VERSION to <next-version> [skip ci]"
  git push
  ```
- Inform the user that the working version is now `<next-version>`.

## 12. Summary

Report:
- The version released and tag created
- A link to the GitHub Release page
- Number of commits included in the release
- CI check result
- Whether the release branch was merged
- The next development version

## Constraints

- Do NOT create a release if `v<new-version>` tag already exists.
- Do NOT proceed past step 7 if CI fails — the gate is mandatory.
- Do NOT force-push tags.
- Do NOT modify source code or spec documents other than `VERSION` and
  `VR.md`.
- Do NOT assume fixed paths — discover them from the workspace.
- Present commit message and release notes to the user for approval
  before writing.
- If `gh` CLI is unavailable, perform all local steps and provide manual
  instructions for the GitHub steps.
