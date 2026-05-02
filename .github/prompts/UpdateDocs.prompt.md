---
description: "Scan the current branch's changes and update spec documents (SDD, HLRs, LLRs, Tests, SDP, SAR) to match the implemented work"
mode: "agent"
tools: [execute, read, search, editFiles]
---
You maintain the TraceR specification stack for any repository that uses
`doc/Project.xml` as its single source of truth. This prompt is generic —
it works regardless of the product domain, language, or framework.

Perform the following steps in order. Stop and report if any step fails.

## 0. Discover project layout

- Locate `doc/Project.xml` (or the path configured in the workspace).
- Locate the tools directory containing `lint_project.py`, `render_doc.py`,
  and `project.xsd` (typically `tools/` or the path the extension resolves).
- Locate the templates directory (typically `tools/templates/`).
- Identify the test directory by scanning for files that match the `<tests>`
  entries in Project.xml (commonly `test/` but may vary).
- Identify which hand-authored documents exist under `doc/` (SDP.md, SAR.md,
  VR.md, PVD.md — any or all may be absent; only update those that exist).
- Locate `User_Manual.md` and `Developers_Guide.md` in the tools directory
  (if they exist).

## 1. Gather branch context

- Read the current branch name (`git branch --show-current`).
- Determine the base branch. Check for `develop`, then `main`, then the
  default branch (`git symbolic-ref refs/remotes/origin/HEAD`).
- Collect committed changes: `git diff --stat <base>..HEAD` and
  `git log --oneline <base>..HEAD`.
- Collect uncommitted changes: `git diff --stat` (unstaged) and
  `git diff --cached --stat` (staged). Include these alongside the
  committed diff — uncommitted work is still "implemented work" that
  specs must cover.
- Read the changed/added source files (committed **and** uncommitted)
  to understand what was implemented.

## 2. Understand existing specs

- Read `doc/Project.xml` to understand the current SDD modules, HLRs, LLRs,
  and Tests.
- Read `doc/SDP.md` (if it exists) to understand the phased delivery plan.
- Read `doc/SAR.md` (if it exists) to understand the security posture.
- Identify which SDD components, HLRs, LLRs, and tests are relevant to the
  changes on this branch.

## 3. Update SDD (in Project.xml)

- If new components/modules were added, add corresponding `<module>` entries
  under `<sdd>`.
- If existing modules were significantly changed, update their descriptions.
- Ensure every new source file or significant subsystem has SDD coverage.
- Present proposed SDD changes to the user for approval before writing.

## 4. Update HLRs (in Project.xml)

- If the branch implements new user-visible behaviour, draft new HLRs that
  describe it.
- Trace each new HLR to the relevant SDD module(s).
- If existing HLRs were fulfilled or their scope changed, update them.
- Allocate IDs using the next free `HLR-NNN` pattern found in the file.
- Present proposed HLR changes to the user for approval before writing.

## 5. Update LLRs (in Project.xml)

- For each new or modified HLR, ensure corresponding LLRs exist that
  describe the implementation details.
- Trace each LLR to its parent HLR(s).
- Allocate IDs using the project's existing `LLR-*` numbering pattern.
- Present proposed LLR changes to the user for approval before writing.

## 6. Update Tests (in Project.xml)

- Scan the test directory for new or modified test files on this branch.
- Ensure each test file and its test functions are registered in Project.xml.
- Trace tests to the LLR(s) they verify.
- Present proposed test changes to the user for approval before writing.

## 7. Update SDP (doc/SDP.md) — if it exists

- Read the Status table and Phased Delivery section.
- If the branch work corresponds to an existing phase:
  - Update the status (✅ Complete, 🔄 In progress, etc.)
  - Update the phase description if deliverables changed.
- If the branch work is NOT covered by any existing phase:
  - Add a new phase at the appropriate position.
  - Add a corresponding row to the Status table with a link to the phase
    heading.
- Present proposed SDP changes to the user for approval before writing.

## 8. Update SAR (doc/SAR.md) — if it exists and applicable

- If the branch changes affect security-relevant code (authentication, input
  validation, dependency changes, secret handling, trust boundaries):
  - Update the relevant sections of `doc/SAR.md`.
  - If new dependencies were added, note them in the Dependency Security
    section.
  - If new input surfaces were added, note them in the Input Validation
    section.
- If no security-relevant changes were made, skip this step and note it in
  the summary.

## 9. Update User Manual and Developers Guide — if they exist

- If `<tools_dir>/User_Manual.md` exists and the branch changes affect
  user-facing behaviour (new commands, changed workflows, new settings,
  new CLI options):
  - Update the relevant sections to document the new behaviour.
  - Present proposed changes to the user for approval before writing.
- If `<tools_dir>/Developers_Guide.md` exists and the branch changes affect
  developer-facing internals (new sidecar methods, schema changes, new
  template conventions, new lint rules, new AI intents, architecture changes):
  - Update the relevant sections to document the new internals.
  - Present proposed changes to the user for approval before writing.
- If neither document needs updating, skip and note in the summary.

## 10. Review cross-references

- After all document updates, review every file that was modified in
  steps 3–9 for internal cross-references (e.g. `§14`, `§15`,
  "see Section 7", `#phase-N` anchor links).
- If any section was inserted, removed, or renumbered, scan all project
  documents (`doc/`, `tools/`, `tools/project.xsd`, `tools/project_io.py`,
  `tools/vscode-project-xml/src/`) for references to the old section
  numbers and update them.
- Present proposed cross-reference fixes to the user for approval before
  writing.

## 11. Validate

- Run `python3 <tools_dir>/lint_project.py` to verify Project.xml is valid.
- Fix any lint errors introduced by the updates.
- Regenerate Markdown spec documents by running `render_doc.py` for each
  template that has a corresponding `<document>` entry in Project.xml's
  `<metadata>` section.

## 12. Summary

Report to the user:
- What SDD modules were added/updated
- What HLRs were added/updated
- What LLRs were added/updated
- What tests were registered
- What SDP phase was updated or added (if SDP exists)
- Whether the SAR was updated and why (if SAR exists)
- Whether User_Manual.md was updated (if it exists)
- Whether Developers_Guide.md was updated (if it exists)
- What cross-references were updated (if any)

## Constraints

- Always present changes to the user for approval before writing to
  Project.xml or any doc/ file.
- Do NOT invent requirements — derive them from the actual code changes.
- Do NOT remove existing specs unless the user explicitly confirms removal.
- Use the existing ID allocation patterns (next free number in sequence).
- Maintain all existing traces — only add new ones.
- After writing Project.xml changes, always re-run the linter to catch errors.
- Regenerate rendered Markdown docs after any Project.xml change.
- Do NOT assume fixed paths — discover them from the workspace structure.
- If a hand-authored document (SDP, SAR, VR) does not exist, skip updates
  to it and note the absence in the summary.
