<p align="center">
  <img src="images/TraceR.png" alt="TraceR logo" width="200">
</p>

# TraceR
Vibe coding with AI doesn't have to be haphazard or even dangerous.

Is your software fielded in safety/certified environments requiring certification audits? Or, do you simply want to improve and demonstrate the quality of your software? Then you will benefit from a software project traceability tool. TraceR turns a single Project.xml file source-of-truth into a fully linked stack of specification documents (SDD, HLRs, LLRs, STP, Traceability Matrix) and provides editor-native authoring with AI assistance to create and maintain them.

See [`doc/PVD.md`](doc/PVD.md) for the Product Vision Document and
[`doc/SDP.md`](doc/SDP.md) for the Software Development Plan (the
phased VS Code extension roadmap).

## Status

| Phase | Description | Status |
| ----- | ----------- | ------ |
| 0     | Sidecar foundations: importable `render_doc.py` / `lint_project.py`, JSON-RPC `tools/project_io.py`, test suite. | ✅ Complete |
| 1     | Read-only VS Code extension: tree view, lint diagnostics, Reveal in XML. | ✅ Complete |
| 2     | Code Lenses + Render & Preview. | ✅ Complete |
| 2.5   | Schema-driven retrofit: `list_documents` discovery, dynamic `Render <Doc>` commands, `Finding.code` linter contract, `ui:*` per-element hints, coverage status badges, `<plan>` acceptance proof. | ✅ Complete |
| 2.5b  | Generic schema-driven projection: full `xs:appinfo` vocabulary, generic `ParsedNode`, tree / lens / locator rewrite. | ✅ Done — Python `_ui_hints_index` + `_nodes` over JSON-RPC; TS shim typed; tree provider auto-projects any `<ui:treeNode/>` payload, lens provider scans schema-declared lens kinds, lint diagnostics resolve schema-declared id tokens. Adding a new payload requires zero TypeScript edits. |
| 2.5c  | Payload-agnostic Quick Fix table keyed on `Finding.code`. | ✅ Done — `CodeActionProvider` dispatches on `Finding.code` (`broken-trace`, `id-format`, `missing-template`, `no-test`); every fix uses `WorkspaceEdit` text edits, none reference payload element name. |
| 3     | Form webviews for HLRs / LLRs. | ✅ Done — `tools/project_edit.py` adds `apply_edit` (lxml round-trip + validate-then-write, byte-identical on failure) and a payload-agnostic XSD→JSON-Schema deriver; sidecar exposes `apply_edit` / `form_schema` / `next_free_id`; React + RJSF webview drives `Project Spec: Add HLR` / `Add LLR` / edit-payload; the structural `no-test` Quick Fix routes through `apply_edit`. |
| 4     | SDD/STP/Test forms + Walkthrough. | ✅ Done — `FormPanelProvider` widened to any complex type carrying a `<ui:form>` annotation; `<ui:form>` added to `StpFixture` and `TestFile`; new commands `Project Spec: Add SDD Module / Add STP Fixture / Add Test File / Add Test`; `Project Spec: Initialise Project.xml…` bootstraps a brand-new project from an empty workspace via the sidecar's `init_project`; seven-step **Get Started with Project Spec** Walkthrough makes the bootstrap-to-first-render flow discoverable from VS Code's Get Started page. Schema bumped to `1.5`. |
| 5a    | Inline AI assistance — Python grounding & pipeline. | ✅ Done — `tools/ai/{registry,context,pipeline,translators,provenance}.py` with 10 registered intents (`draft.{module,hlr,llr,test,pvd}`, `expand.hlr_to_llrs`, `expand.llr_to_tests`, `review.item`, `suggest.traces`, `gap.fix`); per-intent system prompts under `tools/ai/intents/` and Draft-07 JSON Schemas under `tools/ai/schemas/`; sidecar `ai_request` JSON-RPC method (stateless `prepare`/`evaluate`/`run` so the TS layer owns `vscode.lm.*` per HLR-045); deterministic translators emit `apply_edit`-shaped JSON Patches; PVD ghostwriting prompt with clarifying-question rules (HLR-052); provenance JSONL at `<workspace>/.edit_doc/ai_history.jsonl` (HLR-049); `apply_edit` gains `dry_run` for diff-preview; `parse_ui_hints_index` projects `ai_actions` per `<ui:treeNode/>` payload (HLR-053). New JSON-RPC error code `-32020 NO_LANGUAGE_MODEL`. 123 unittests green. |
| 5b    | Inline AI assistance — TypeScript surfaces. | ✅ Done — `@projectspec` chat participant (`vscode.chat.createChatParticipant`) with slash commands `/draft-hlr`, `/draft-llr`, `/draft-test`, `/draft-module`, `/draft-pvd`, `/expand`, `/review`, `/suggest-traces`, `/gap-fill`; schema-driven AI tree context-menu entries projected from `ui_hints_index.ai_actions`; AI Quick Fix variant on `broken-trace`; diff-preview-and-apply with timestamped backup under `.edit_doc/backups/`; settings UI for `projectXml.ai.{enabled,modelFamily,maxTokens,autoApplyValidated,historyLog}`; graceful degradation per HLR-044/045 — when `vscode.lm.selectChatModels` returns no models, the workspace is untrusted, or `projectXml.ai.enabled` is false, every AI surface is hidden cleanly while every deterministic surface (tree, diagnostics, lenses, form panels, render, Stage A merge) remains fully functional. |
| 5.5   | AI-assisted merge conflict resolution. | ⏳ Not started |
| 6     | Marketplace polish. | ⏳ Not started — includes self-contained `.vsix` (bundled `dist/python/` sidecar copy), `Scaffold tools/ into workspace…` command, automatic scaffolding from `initProject` in empty workspaces, and a bundled-vs-workspace freshness notification (HLR-060 / HLR-061 / HLR-062). |

## CLI tooling

The Python tooling under [`tools/`](tools/) is the engine the editor
extension shells out to; it is also usable on its own.

```bash
# Bootstrap a brand-new Project.xml (writes doc/Project.xml + doc/PVD.md).
python3 tools/render_doc.py --init --name MyProject --short-name MP --author "Me"

# Render every spec doc from Project.xml.
python3 tools/render_doc.py --all

# Validate Project.xml against the XSD + semantic linter.
python3 tools/lint_project.py

# Run the JSON-RPC sidecar interactively (used by the VS Code extension).
echo '{"method":"lint"}' | python3 tools/project_io.py

# Run the test suite.
python3 -m unittest discover -s test -v
```

## VS Code extension

The extension lives in
[`tools/vscode-project-xml/`](tools/vscode-project-xml/) and currently
ships Phases 1, 2, 2.5, 2.5b, 2.5c, 3, and 4:

* A **Project Spec** activity-bar view with five top-level nodes
  (HLRs, LLRs, Tests, SDD, STP), each showing live counts and
  expanding to children. Leaves carry per-element decoration
  (`ui:icon` / `ui:color`) sourced from the XSD's reserved
  `urn:tracer:ui:v1` namespace, plus coverage status badges
  (❌ for errors, ⚠ for warnings) keyed on `Finding.code`.
* **Lint diagnostics** in the Problems panel, mirrored from
  `tools/project_io.py lint`. Findings carry a stable `code`
  (`broken-trace` / `id-format` / `missing-template` / `no-test`)
  alongside the human-readable message; errors are anchored to the
  offending HLR/LLR id range in `doc/Project.xml` where possible.
* **Code Lenses** over `<hlr>`, `<llr>`, and `<test>` elements with
  coverage / traces-count summaries and click-through to related
  elements.
* **Render & Preview** via `Project Spec: Render and Preview` and
  `Project Spec: Render All`, plus a **dynamic `Render <Doc>` command
  per `<metadata><document>` entry** discovered at activation time —
  adding a new document row (with template/output) makes a new
  `Render <id>` command appear with zero TypeScript changes. Preview
  is served from an in-memory `tracer-preview:` virtual document and
  never writes a file under `doc/`.
* **Project Spec: Reveal in Project.xml** on every tree node — opens
  `doc/Project.xml` and selects the matching element.
* **Quick Fixes** in the Problems panel, dispatched on `Finding.code`
  (never on payload element name): `broken-trace` opens an id picker
  populated from the parsed tree, `id-format` renumbers as the next
  free `HLR-NNN` / `LLR-XXX-NN`, `missing-template` stubs the missing
  `.j2` file, and `no-test` inserts a stub `<test>` block. Every fix
  uses `vscode.WorkspaceEdit` text edits; structural rewrites that
  need an XSD-validated round trip migrate onto the Phase 3
  `apply_edit` write path once it lands.
* Auto-refresh of the tree, re-lint, and badge update when
  `doc/Project.xml` is saved.

Write surfaces: structural payload edits (Add HLR, Add LLR, edit
existing HLR/LLR, and the `no-test` Quick Fix) all funnel through the
Phase 3 `apply_edit` validate-then-write path so `doc/Project.xml`
stays XSD- and lint-clean and round-trips with comments / CDATA /
attribute order preserved. The remaining `broken-trace`, `id-format`,
and `missing-template` Quick Fixes are flat text rewrites and stay on
`vscode.WorkspaceEdit`.

Phase 4 widens the form panel to **every** complex type that carries
a `<ui:form>` annotation in `tools/project.xsd` — adding a new
payload kind to the form surface is now a schema change, not a
TypeScript change. Out of the box that means `Project Spec: Add SDD
Module / Add STP Fixture / Add Test File / Add Test`. Brand-new
projects bootstrap from an empty workspace via `Project Spec:
Initialise Project.xml…`, which prompts for `name` / `short_name` /
`author` and asks the sidecar to scaffold `doc/Project.xml` and
`doc/PVD.md`. The seven-step **Get Started with Project Spec**
Walkthrough makes the bootstrap-to-first-render flow discoverable
from VS Code's Get Started page.

### Building the extension

```bash
cd tools/vscode-project-xml
npm install
npm run build       # bundles dist/extension.js
npm run compile     # type-check only
```

### Launching the Extension Development Host

The recommended flow is to launch via VS Code's debugger so source
maps and breakpoints work:

1. Open `tools/vscode-project-xml/` in VS Code (must be opened as the
   root folder of its own window so VS Code reads
   `.vscode/launch.json`).
2. Press **F5** (or pick **Run Extension** from Run and Debug,
   Ctrl+Shift+D). A new window labelled `[Extension Development
   Host]` opens.
3. In that window, **`File → Open Folder…`** → select the TraceR
   repo root → trust the workspace.
4. Click the **Project Spec** icon in the activity bar.

If VS Code already has the TraceR folder open in another window and
silently routes the open-folder action there instead, work around it
by opening TraceR through a different path:

```bash
ln -s /path/to/TraceR /tmp/tracer-edh
# then File → Open Folder → /tmp/tracer-edh in the EDH window
```

### Settings

| Key | Default | Meaning |
| --- | ------- | ------- |
| `projectXml.xmlPath`         | `doc/Project.xml`   | Workspace-relative path to Project.xml. |
| `projectXml.xsdPath`         | `tools/project.xsd` | Workspace-relative path to project.xsd. |
| `projectXml.toolsDir`        | `tools`             | Directory containing `project_io.py`. |
| `projectXml.pythonPath`      | _(empty)_           | Override the Python interpreter (defaults to `python3` / `python`). |
| `projectXml.autoLintOnChange`| `true`              | Re-lint on save. |
| `projectXml.previewOnSave`   | `true`              | Refresh the Markdown preview when `Project.xml` is saved. |
| `projectXml.showCoverageBadges` | `true`           | Show ❌ / ⚠ status badges on HLR/LLR tree leaves. |

### Acceptance checks

In the Extension Development Host window:

1. **Tree view** — `HLRs (n)`, `LLRs (n)`, `Tests (n, k files)`,
   `SDD (k modules)`, `STP` are visible and counts match Project.xml.
   Leaves with errors show ❌, warnings show ⚠.
2. **Linter** — Ctrl+Shift+P → **Project Spec: Run Linter** shows a
   toast and populates the Problems panel.
3. **Reveal in XML** — right-click any tree leaf →
   **Project Spec: Reveal in Project.xml** jumps to the element in
   `doc/Project.xml`.
4. **Code Lenses** — open `doc/Project.xml`; lenses appear above
   `<hlr>`, `<llr>`, and `<test>` elements with coverage summaries.
5. **Render & Preview** — Ctrl+Shift+P → **Project Spec: Render
   and Preview** opens the rendered Markdown in a side pane. The
   palette also lists one `Project Spec: Render <Doc>` command per
   `<metadata><document>` entry.

## Repository layout

```
doc/
  PVD.md             # Product Vision Document (hand-authored)
  SDP.md             # Software Development Plan (phased extension roadmap)
  Project.xml        # single source of truth (XSD-validated)
  SDD.md, HLRs.md, LLRs.md, STP.md, Traceability.md   # generated
  Schema_Reference.md  # human-facing schema reference
tools/
  render_doc.py      # Project.xml → Markdown via Jinja2
  lint_project.py    # XSD + semantic linter (emits Finding.code)
  project_io.py      # JSON-RPC 2.0 server over stdio
  project.xsd        # canonical schema (reserves urn:tracer:ui:v1)
  PLAN_web_form.md
  templates/         # Jinja2 templates for each spec doc
  vscode-project-xml/  # VS Code extension (Phases 1 + 2 + 2.5 + 2.5b + 2.5c + 3 + 4)
test/                # unittest suite for the Python tooling
```

## License

See [`LICENSE`](LICENSE).
