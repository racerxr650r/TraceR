---
name: tracer
description: "Use when working on a project that uses TraceR for requirements traceability. TraceR manages design, requirements, and verification through a single `doc/Project.xml` source of truth and generates linked specification documents (SDD, HLRs, LLRs, STP, Traceability). USE FOR: adding or editing HLRs, LLRs, tests, or SDD modules; rendering spec documents; running the linter; understanding the traceability chain (SDD→HLR→LLR→Test); writing tests that need traceability annotations; working with `Project.xml` structure; using the TraceR VS Code extension or CLI tools. DO NOT USE FOR: code changes unrelated to requirements or design; general build/CI troubleshooting unrelated to TraceR tooling."
---

# TraceR — Requirements Traceability Skill

## What Is TraceR?

TraceR keeps your project's design, requirements, and tests traceable
to each other. You write everything once in a single file
(`doc/Project.xml`) and TraceR generates a fully linked set of
specification documents:

| Document | Source payload | Template |
|----------|--------------|----------|
| `doc/SDD.md` — Software Design Document | `<sdd>` | `tools/templates/SDD.md.j2` |
| `doc/HLRs.md` — High-Level Requirements | `<hlrs>` | `tools/templates/HLRs.md.j2` |
| `doc/LLRs.md` — Low-Level Requirements | `<llrs>` | `tools/templates/LLRs.md.j2` |
| `doc/STP.md` — Software Test Plan | `<stp>` + `<tests>` | `tools/templates/STP.md.j2` |
| `doc/Traceability.md` — Traceability Matrix | All `<traces>` | `tools/templates/Traceability.md.j2` |

The **Product Vision Document** (`doc/PVD.md`) sits above the generated
stack and is hand-authored.

## Traceability Chain

Every element traces upstream through `<traces>` blocks:

```
SDD modules
  ↑ traced by
HLRs  (High-Level Requirements)
  ↑ traced by
LLRs  (Low-Level Requirements)
  ↑ traced by
Tests
```

Missing traces produce coverage-gap rows in `doc/Traceability.md` and
lint warnings from the linter.

## Key Files

| Path | Purpose |
|------|---------|
| `doc/Project.xml` | **Single source of truth** — all design, requirements, and test metadata |
| `doc/PVD.md` | Hand-authored Product Vision Document |
| `tools/project.xsd` | XML Schema — validates `Project.xml` structure |
| `tools/render_doc.py` | Jinja2 renderer — generates spec docs from `Project.xml` |
| `tools/lint_project.py` | Linter — checks coverage gaps, dangling refs, id conventions |
| `tools/project_io.py` | JSON-RPC sidecar — the VS Code extension communicates through this |
| `tools/project_edit.py` | Schema-driven edit operations (add HLR, LLR, test, module) |
| `tools/Developers_Guide.md` | Schema reference, renderer data surface, linter contract |
| `tools/User_Manual.md` | Installation, getting started, extension and CLI usage |

## Hard Rules

1. **Never edit generated `.md` files directly.** Edit `doc/Project.xml`
   (or the relevant Jinja2 template), then render. Changes to generated
   files will be overwritten.

2. **Every `<hlr>` must trace to at least one `<sdd>` section.** Every
   `<llr>` must trace to at least one `<hlr>`. Every `<test>` must
   trace to at least one `<llr>` or `<hlr>`.

3. **IDs are stable contracts.** Never renumber existing `HLR-NNN` or
   `LLR-XXX-NN` IDs. Allocate the next free number when adding new ones.

4. **Wrap content containing `<`, `&`, backticks, or markdown links in
   `<![CDATA[...]]>`.** Bare content will corrupt the XML.

5. **Render and lint after every edit to `Project.xml`.** This catches
   broken references, coverage gaps, and template drift immediately.

6. **Keep `tools/Developers_Guide.md` in sync.** Any change to
   `tools/project.xsd` must be reflected in the Developer's Guide in
   the same commit.

## Decision Flow

| You want to… | Do this |
|-------------|---------|
| Add a High-Level Requirement | Add `<hlr id="HLR-NNN" name="...">` inside the appropriate `<hlrs>/<section>` with `<traces target="SDD">`. Render `HLRs.md` and `Traceability.md`. |
| Add a Low-Level Requirement | Add `<llr id="LLR-XXX-NN">` inside the matching `<llrs>/<function>` with `<traces target="HLR">`. Render `LLRs.md` and `Traceability.md`. |
| Add a test | Write the test code, then add a `<test name="...">` entry inside the appropriate `<tests>/<file>` with `<purpose>` and `<traces>`. Render `STP.md` and `Traceability.md`. |
| Add an SDD module | Add a `<module path="...">` inside `<sdd>`. Render `SDD.md`. |
| Fix a coverage gap | The element has no `<test>` whose `<traces>` cite it. Either add a test, or add the missing trace to an existing test. |
| Update a spec section | Edit the corresponding node in `Project.xml`, then render the affected document(s). |

## CLI Commands

All commands run from the repository root via `make -C tools <target>`:

```bash
# Render all five spec documents
make -C tools render

# Lint Project.xml (checks coverage gaps, dangling refs, id format)
make -C tools lint

# Validate Project.xml against the XSD schema
make -C tools validate-xml

# Run all tests (Python + VS Code unit + UI)
make -C tools test

# Full CI check (lint + validate + render + test + build)
make -C tools ci

# Build the VS Code extension
make -C tools ext-build

# Package a .vsix installer
make -C tools ext-package
```

### Rendering individual documents

```bash
python3 tools/render_doc.py tools/templates/SDD.md.j2          SDD          --out doc/SDD.md
python3 tools/render_doc.py tools/templates/HLRs.md.j2         HLRs         --out doc/HLRs.md
python3 tools/render_doc.py tools/templates/LLRs.md.j2         LLRs         --out doc/LLRs.md
python3 tools/render_doc.py tools/templates/STP.md.j2          STP          --out doc/STP.md
python3 tools/render_doc.py tools/templates/Traceability.md.j2 Traceability --out doc/Traceability.md
```

## VS Code Extension

The TraceR VS Code extension provides:

- **Tree view** — structural view of HLRs, LLRs, Tests, and SDD modules
  with item counts and coverage tooltips
- **Lint diagnostics** — real-time error/warning markers in the Problems
  panel and a status bar summary
- **Code lenses** — inline coverage indicators on HLR/LLR elements in
  `Project.xml`
- **Form panels** — schema-driven edit forms for every payload type
  (HLR, LLR, Test, SDD module) with coverage hints and trace editing
- **Context menus** — right-click to reveal in XML, edit in form, or
  add new items from group nodes
- **Dropdown menu** — view title menu with Refresh, Run Linter, Render
  All Documents, Resolve Merge Conflicts, and Initialize Project.xml
- **AI assistance** (optional) — `@projectspec` chat participant for
  drafting, reviewing, and expanding requirements

### Key extension commands

All commands are available via the Command Palette (`Ctrl+Shift+P`):

| Command | Action |
|---------|--------|
| `Project Spec: Refresh` | Reload the tree view from `Project.xml` |
| `Project Spec: Run Linter` | Lint and update diagnostics |
| `Project Spec: Render All Documents` | Regenerate all five spec docs |
| `Project Spec: Edit in Form…` | Open the schema-driven edit form for an element |
| `Project Spec: Reveal in Project.xml` | Jump to the element's XML source |
| `Project Spec: Initialise Project.xml…` | Bootstrap a new project from scratch |

## Common Pitfalls

- **Editing `doc/SDD.md` instead of `Project.xml`.** Always check if
  the prose you want to change lives in `Project.xml` first.
- **Adding a test without a `<test>` entry in `Project.xml`.** The test
  won't appear in `STP.md` or the Traceability Matrix until registered.
- **Forgetting `<traces>` blocks.** Every HLR, LLR, and test must trace
  upstream or it becomes an immediate coverage gap.
- **Putting headings inside `<sdd>` bodies.** Templates emit their own
  headings; duplicates cause mis-numbered output.
- **Not rendering after edits.** The generated `.md` files are stale
  until you re-render.
