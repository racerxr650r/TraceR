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
| 2.5c  | Payload-agnostic Quick Fix table keyed on `Finding.code`. | ⏳ Not started |
| 3     | Form webviews for HLRs / LLRs. | ⏳ Not started |
| 4     | SDD/STP/Test forms + Walkthrough. | ⏳ Not started |
| 5     | Inline AI assistance (`@projectspec` chat participant). | ⏳ Not started |
| 5.5   | AI-assisted merge conflict resolution. | ⏳ Not started |
| 6     | Marketplace polish. | ⏳ Not started |

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
ships Phases 1, 2, and 2.5:

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
* Auto-refresh of the tree, re-lint, and badge update when
  `doc/Project.xml` is saved.

The extension is **strictly read-only** in this phase; no command
mutates `Project.xml`. (Write surfaces land in Phases 2.5c / 3.)

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
  vscode-project-xml/  # VS Code extension (Phases 1 + 2 + 2.5)
test/                # unittest suite for the Python tooling
```

## License

See [`LICENSE`](LICENSE).
