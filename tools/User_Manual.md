# TraceR User Manual

## Overview

TraceR turns a single `doc/Project.xml` file — the **single source
of truth** for your project's design, requirements, and verification
artefacts — into a fully-linked stack of specification documents:

*   [`doc/SDD.md`](../doc/SDD.md) — Software Design Document
*   [`doc/HLRs.md`](../doc/HLRs.md) — High-Level Requirements
*   [`doc/LLRs.md`](../doc/LLRs.md) — Low-Level Requirements
*   [`doc/STP.md`](../doc/STP.md) — Software Test Plan
*   [`doc/Traceability.md`](../doc/Traceability.md) — Traceability
    Matrix (SDD → HLR → LLR → Test forward and reverse)

Above the generated stack sits the hand-authored
[`doc/PVD.md`](../doc/PVD.md) — the Product Vision Document.

TraceR ships two surfaces against this single source of truth:

1.  **A VS Code extension** (the day-to-day authoring surface) that
    contributes a structured *Project Spec* tree view, lint
    diagnostics in the Problems panel, code lenses with coverage
    summaries, schema-driven form panels for every payload, a
    seven-step Get Started Walkthrough, an `@projectspec` chat
    participant for AI-assisted authoring, and an AI-assisted
    three-way merge resolver for `doc/Project.xml`.
2.  **A Python command-line toolchain** (the same engine the
    extension shells out to) that you can run on its own from a
    shell, a Makefile, or CI without any IDE installed.

Both surfaces share the same backend logic and the same XSD; if it
lints clean from the CLI it lints clean in the editor, and vice
versa.

> **Where to read more.** The full schema, template-author guide,
> and contributor reference live in the
> [Developer's Guide](Developers_Guide.md). The phased delivery
> roadmap and per-phase acceptance criteria live in
> [`doc/SDP.md`](../doc/SDP.md). The product vision and success
> metrics live in [`doc/PVD.md`](../doc/PVD.md).

## Installation

### System prerequisites

You need a Python 3.10+ interpreter with [Jinja2](https://pypi.org/project/Jinja2/)
on PATH. [lxml](https://pypi.org/project/lxml/) (or the `xmllint`
binary from `libxml2-utils`) is optional but recommended for strict
XSD validation; the linter degrades gracefully when neither is
present. For the VS Code extension you also need Node.js 20 LTS and
VS Code 1.90+.

The full per-platform setup (apt, dnf, pacman, Homebrew) is in
[`doc/SDP.md` §0 *Required Tools for Development*](../doc/SDP.md).

### Installing the VS Code extension

The shipped `.vsix` ships a copy of the entire Python toolchain
under `dist/python/` so the extension works in any workspace as
long as a Python 3.10+ interpreter is on PATH.

```bash
# 1. Install the Red Hat XML extension (required dependency).
code --install-extension redhat.vscode-xml

# 2. Install the TraceR extension from a local .vsix.
code --install-extension tracer-project-xml-<version>.vsix
```

When the VS Code Marketplace listing is published, replace step 2
with `code --install-extension <publisher>.tracer-project-xml`.

The first time you open a workspace that has no `tools/` directory,
the extension offers a **Project Spec: Scaffold tools/ into
workspace…** command that copies its bundled Python tree into your
workspace, so the CLI, CI, and other contributors who do not have
the extension installed all work without further setup.

### Installing the CLI by itself

Clone the repository and add `tools/` to your PATH (or invoke the
scripts by absolute path). Inside a virtual environment:

```bash
git clone https://github.com/racerxr650r/TraceR.git
cd TraceR
python3 -m venv .venv && source .venv/bin/activate
pip install jinja2 lxml pytest
```

The CLI does not require the extension. Conversely the extension
does not require a checkout — its bundled `dist/python/` provides
everything the sidecar spawns.

## Getting Started

### Bootstrapping a brand-new project

The fastest path is the **Get Started with Project Spec** Walkthrough
inside VS Code:

1.  Open an empty workspace folder.
2.  Run **Help → Get Started → Project Spec**, or use the Command
    Palette (Ctrl/Cmd+Shift+P) and pick
    **Project Spec: Show Walkthrough**.
3.  Step through the seven cards: scaffold `tools/`, initialise
    `doc/Project.xml`, add an HLR, add an LLR, add a Test, lint, and
    render.

Each card links to the relevant command. By the end you have a
populated `doc/Project.xml`, a populated `doc/PVD.md`, and all five
spec documents rendered under `doc/`.

The same outcome is available headlessly from the CLI:

```bash
python3 tools/render_doc.py --init \
    --name "MyProject" \
    --short-name MP \
    --author "Me" \
    --xml doc/Project.xml \
    --pvd-out doc/PVD.md
python3 tools/render_doc.py --all   # renders SDD/HLRs/LLRs/STP/Traceability
python3 tools/lint_project.py
```

### Editing an existing project

Open the workspace in VS Code; the *Project Spec* activity-bar icon
opens the structural tree. From there:

*   Right-click any leaf → **Reveal in Project.xml** to jump to the
    element in the XML.
*   Right-click any payload node → **Add HLR / Add LLR / Add Test
    /…** to open a form panel.
*   Right-click any payload node → **Draft / Expand / Review /
    Suggest traces / Fix gap with AI** to invoke a grounded AI
    intent (when a language model is available — see
    [VS Code Extension → AI surfaces](#ai-surfaces) below).
*   Save `doc/Project.xml` → diagnostics, badges, and the side
    Markdown preview update on the fly.

### Anatomy of a TraceR repository

```
doc/
  PVD.md             # Product Vision Document (hand-authored)
  SDP.md             # Software Development Plan (phased roadmap)
  Project.xml        # single source of truth (XSD-validated)
  SDD.md             # generated
  HLRs.md            # generated
  LLRs.md            # generated
  STP.md             # generated
  Traceability.md    # generated
tools/
  User_Manual.md       # this document
  Developers_Guide.md  # schema reference + template-author guide
  render_doc.py        # Project.xml → Markdown via Jinja2
  lint_project.py      # XSD + semantic linter (emits Finding.code)
  project_io.py        # JSON-RPC 2.0 sidecar over stdio
  project_edit.py      # apply_edit / form_schema / next_free_id
  project_merge.py     # Stage A deterministic three-way merger
  project.xsd          # canonical schema (reserves urn:tracer:ui:v1)
  templates/           # Jinja2 templates for each generated doc
  ai/                  # AI registry + intents + schemas + pipeline
  vscode-project-xml/  # the VS Code extension source
test/                  # unittest suite for the Python tooling
```

The five generated `*.md` files are **never** edited by hand — they
are rebuilt from `doc/Project.xml` by the renderer. See the
[Developer's Guide](Developers_Guide.md) for the schema and the
template-author rules.

## VS Code Extension

The extension contributes a *Project Spec* activity-bar view, lint
diagnostics, code lenses, form panels, a Walkthrough, an AI chat
participant, and an AI-assisted merge resolver. All of them are
**schema-driven** — adding a new payload kind to
[project.xsd](project.xsd) (with `<ui:treeNode>` / `<ui:lens>` /
`<ui:form>` annotations) wires up the tree, lenses, and form panel
without any TypeScript edits.

### The Project Spec tree

The activity-bar tree has top-level nodes for every payload that
declares a `<ui:treeNode>` annotation in the XSD. Out of the box:

*   **HLRs** — every `<hlr>` grouped by `<section>`.
*   **LLRs** — every `<llr>` grouped by `<function>`.
*   **Tests** — every `<test>`, grouped by source file.
*   **SDD** — every SDD module.
*   **STP** — Software Test Plan fixtures.

Each leaf carries:

*   The element's `id` and `name`.
*   An optional decoration sourced from per-element `ui:icon` /
    `ui:color` attributes (purely cosmetic — the extension passes
    these through, the renderer ignores them).
*   A coverage status badge: ❌ when any error finding cites it,
    ⚠ when only warnings do (gated on
    `projectXml.showCoverageBadges`).

### Lint diagnostics

`tools/project_io.py lint` runs automatically on save (gated on
`projectXml.autoLintOnChange`). Findings appear in the Problems
panel, anchored to the offending element's range in
`doc/Project.xml`. Each finding carries a stable `code` field
(`broken-trace`, `id-format`, `missing-template`, `no-test`); the
*Quick Fix* lightbulb dispatches on the `code`, never on element
name. See
[Developer's Guide §15 *Linter Contract*](Developers_Guide.md#15-linter-contract-finding-findingsitems-code-values).

The status bar shows a live `n errors / m warnings` count. Click it
to focus the Problems panel filtered to `Project.xml`.
`projectXml.warningsAsErrors` raises severity but **never**
suppresses warnings.

### Code lenses

Above every `<hlr>`, `<llr>`, and `<test>` in `doc/Project.xml`:

*   **Coverage** — counts of downstream LLRs / tests, click-through
    to each.
*   **Traces count** — counts of incoming `<traces>`, click-through
    to each upstream item.

The lens kinds (`coverage`, `tracesCount`) are declared via
`<ui:lens kind="..."/>` in the XSD; new payload kinds opt in by
adding the same annotation.

### Render and preview

*   **Project Spec: Render and Preview** opens the rendered
    Markdown for the affected document in a side preview pane. The
    preview is served from an in-memory virtual document
    (`tracer-preview:/<doc-id>.md`) and **never** writes a file
    under `doc/`.
*   **Project Spec: Render All** regenerates every `<metadata>
    <document>` entry to its `output=` path.
*   One **Project Spec: Render `<DocId>`** command per
    `<metadata><document>` entry — discovered at activation, so
    adding a new generated document just requires a new
    `<document>` row and a template under
    [templates/](templates/).

`projectXml.previewOnSave` (default `true`) keeps the side preview
in sync with the file you are editing.

### Form panels

For every complex type that carries a `<ui:form>` annotation in
[project.xsd](project.xsd), the extension contributes an **Add**
command that opens a webview with a form derived from the schema:

*   `Project Spec: Add HLR` / `Add LLR`
*   `Project Spec: Add SDD Module`
*   `Project Spec: Add STP Fixture`
*   `Project Spec: Add Test File` / `Add Test`

Form submissions go through the sidecar's `apply_edit` JSON-RPC
method, which:

1.  Applies the edit to a working copy of the parsed XML.
2.  Validates the result against the XSD and runs `lint_project.lint`.
3.  Writes back **only on a clean result**, via `lxml`, so
    comments, CDATA, attribute order, and whitespace are preserved.
4.  Returns the diagnostics on failure, leaving `doc/Project.xml`
    byte-identical to its pre-call state.

When the file is open with unsaved changes, the extension prompts
you to save or discard before applying the patch.

### Quick Fixes

The Problems panel's lightbulb offers fixes keyed on the lint
finding's `code`:

| Code               | Quick Fix |
|--------------------|-----------|
| `broken-trace`     | Replace ref… (id picker populated from the parsed tree). |
| `id-format`        | Renumber as the next free `HLR-NNN` / `LLR-XXX-NN`. |
| `missing-template` | Stub the missing `.j2` file. |
| `no-test`          | Insert a stub `<test>` block. |

Flat text rewrites use `vscode.WorkspaceEdit`; structural rewrites
(currently only `no-test`) route through the `apply_edit` write
path.

### AI surfaces

When `vscode.lm.selectChatModels()` returns at least one model and
`projectXml.ai.enabled` is `true` and the workspace is trusted, the
extension contributes:

*   The **`@projectspec` chat participant** with the slash commands
    `/draft-hlr`, `/draft-llr`, `/draft-test`, `/draft-module`,
    `/draft-pvd`, `/expand`, `/review`, `/suggest-traces`,
    `/gap-fill`, and (Phase 5.5) `/resolve-conflicts`.
*   **Right-click AI menu items** on every Project Spec tree node,
    derived from each payload's `<ui:treeNode>` `aiActions`
    projection — *not* hard-coded per element kind. A new payload
    that carries the annotation inherits the applicable AI menu
    automatically.
*   An **AI-suggest variant** of the `broken-trace` Quick Fix.
*   A **diff-preview-and-apply** flow: every accepted AI edit
    writes a timestamped backup under `.edit_doc/backups/`, appends
    a provenance entry to `.edit_doc/ai_history.jsonl`, and only
    then applies the patch.

When no model is available, the workspace is untrusted, or
`projectXml.ai.enabled` is `false`, every AI surface hides itself
cleanly and the deterministic surfaces (tree, diagnostics, lenses,
form panels, render, Stage A merge) keep working unchanged. This
graceful-degradation contract is the
[PVD §7.1](../doc/PVD.md) baseline.

### Merge conflict resolution

When `doc/Project.xml` is conflicted, **Project Spec: Resolve Merge
Conflicts** opens the Stage A deterministic three-way merger over
`:1:` / `:2:` / `:3:` blobs from `git show`, presents the merged
result in VS Code's three-way merge editor, and (when AI is
available) badges per-region resolutions with ✨. The extension
**never** writes the merged file automatically — the merge editor
is the only commit surface. Settings:
`projectXml.merge.enabled` (default `true`),
`projectXml.merge.aiResidualResolution` (default `true`, forced
`false` when `projectXml.ai.enabled` is `false`).

### Settings reference

| Key | Default | Meaning |
| --- | ------- | ------- |
| `projectXml.xmlPath`         | `doc/Project.xml`   | Workspace-relative path to Project.xml. |
| `projectXml.xsdPath`         | `tools/project.xsd` | Workspace-relative path to project.xsd. |
| `projectXml.toolsDir`        | `tools`             | Directory containing `project_io.py`; falls back to `<extensionPath>/dist/python` when absent. |
| `projectXml.pythonPath`      | _(empty)_           | Override the Python interpreter (defaults to `python3` / `python`). |
| `projectXml.autoLintOnChange`| `true`              | Re-lint on save. |
| `projectXml.warningsAsErrors`| `false`             | Escalate lint warnings to error severity in the Problems panel and the status bar. NEVER suppresses warnings — only raises severity. |
| `projectXml.previewOnSave`   | `true`              | Refresh the Markdown preview when `Project.xml` is saved. |
| `projectXml.showCoverageBadges` | `true`           | Show ❌ / ⚠ status badges on HLR/LLR tree leaves. |
| `projectXml.ai.enabled`      | `true`              | Enable AI surfaces. Setting to `false` hides every AI surface cleanly. |
| `projectXml.ai.modelFamily`  | _(empty)_           | Optional language-model family selector (e.g. `gpt-4o`); empty means no constraint. |
| `projectXml.ai.maxTokens`    | `8000`              | Token budget for the AI grounding bundle. |
| `projectXml.ai.autoApplyValidated` | `false`       | When `true`, validated AI patches skip the diff-preview gate. |
| `projectXml.ai.historyLog`   | `true`              | Append every AI step to `<workspace>/.edit_doc/ai_history.jsonl`. |
| `projectXml.merge.enabled`   | `true`              | Enable Stage A deterministic three-way structural merge for `doc/Project.xml`. |
| `projectXml.merge.aiResidualResolution` | `true`   | Use `merge.*` AI intents to suggest resolutions for residual conflicts. Forced `false` when `projectXml.ai.enabled` is `false`. |

## Command Line Tools

Every CLI script under [`tools/`](.) accepts `--help`. The most
common entry points:

### `render_doc.py` — generate the spec docs

```bash
# Render every <metadata><document> entry to its `output=` path.
python3 tools/render_doc.py --all

# Render a single document by id (the second positional argument
# selects the <metadata><document id="..."> entry).
python3 tools/render_doc.py tools/templates/HLRs.md.j2 HLRs --out doc/HLRs.md

# Bootstrap a brand-new Project.xml + PVD.md.
python3 tools/render_doc.py --init \
    --name "MyProject" --short-name MP --author "Me" \
    --xml doc/Project.xml --pvd-out doc/PVD.md
```

### `lint_project.py` — XSD + semantic linter

```bash
python3 tools/lint_project.py
```

Returns exit 0 on a clean run; non-zero on any error finding.
Warnings do not fail the run unless `--warnings-as-errors` is
passed. The structured findings (`Finding.code`) feed both the CLI
report and the VS Code diagnostics surface; see
[Developer's Guide §15](Developers_Guide.md#15-linter-contract-finding-findingsitems-code-values).

### `project_io.py` — JSON-RPC 2.0 sidecar over stdio

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"lint","params":{}}' \
    | python3 tools/project_io.py
```

The VS Code extension spawns this script as a long-running child
and dispatches over JSON-RPC. Methods include `lint`, `render`,
`render_all`, `parse_to_json`, `list_documents`, `apply_edit`,
`form_schema`, `next_free_id`, `init_project`, `merge_three_way`,
`apply_merge_resolution`, and `ai_request`. Method signatures are
documented in [`tools/project_io.py`](project_io.py).

### `project_merge.py` — three-way structural merger

Invoked indirectly via the sidecar's `merge_three_way` method. The
deterministic Stage A merger preserves comments, CDATA, attribute
order, and whitespace; unions disjoint additions and `<traces>`
rows; reallocates colliding ids on the new side; and refuses
cleanly when the Git merge base is unavailable
(rebase-in-progress, octopus merge, cherry-pick without a base) so
the user never silently loses content.

### `tools/Makefile`

Convenience targets for CI and local checking:

```bash
make -C tools render        # full re-render with drift check
make -C tools lint          # python3 tools/lint_project.py
make -C tools validate-xml  # XSD validation only
make -C tools test          # unittest suite
make -C tools ci            # render + lint + validate + test
```

## Example Workflow

A typical end-to-end flow on an existing TraceR repository:

1.  **Pull and open in VS Code.**

    ```bash
    git pull
    code .
    ```

    The Project Spec activity-bar icon appears once
    `doc/Project.xml` is detected.

2.  **Add a new HLR.** Right-click *HLRs* in the tree →
    **Add HLR**. Fill the form (id is pre-allocated to the next
    free `HLR-NNN`); on save the extension validates and writes the
    XML, the rendered `HLRs.md` preview updates, and the
    Traceability matrix re-renders.

3.  **Drive its LLR(s) with AI.** Right-click the new HLR →
    **Expand with AI** (or `@projectspec /expand` in the chat
    pane). The AI proposes a candidate set of LLRs with HLR traces
    pre-populated; each candidate is XSD- and lint-validated before
    it is shown. Accept the diff preview to apply.

4.  **Add tests.** Either right-click an LLR → **Add Test**, or use
    `@projectspec /draft-test` in chat. Tests automatically inherit
    the LLR's traces.

5.  **Lint and render.** Save the file. The status bar shows
    `0 errors / 0 warnings`; the side preview reflects the new
    content. From the CLI:

    ```bash
    python3 tools/lint_project.py
    make -C tools render
    ```

6.  **Commit.** The five generated `*.md` files appear in the diff
    alongside `doc/Project.xml`; commit all together. The
    `prepackage` step that ships the `.vsix` runs in the GitHub
    Actions workflow on `vscode-v*` tag pushes — no manual step.

7.  **Resolve a merge conflict (optional).** When two branches both
    edit `doc/Project.xml`, run **Project Spec: Resolve Merge
    Conflicts**. The Stage A merger unions the disjoint additions
    automatically; residual semantic conflicts (same body edited on
    both sides) are presented in the merge editor with AI
    suggestions badged ✨ — accept or reject per region; nothing is
    written until you commit the merge editor's result.

For deeper coverage of any of these steps, the
[Developer's Guide](Developers_Guide.md) documents the schema,
the renderer's data surface, the linter contract, and the recipe
for adding a brand-new generated document.
