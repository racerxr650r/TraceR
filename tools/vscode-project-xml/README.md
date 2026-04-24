# vscode-project-xml — Project Spec (TraceR)

Read-only Phase 1 scaffold for the TraceR Project Spec extension.
See [`doc/SPD.md`](../../doc/SPD.md) for the full Software Plan
Document.

## What this build does

* Activates on workspaces containing `doc/Project.xml`.
* Spawns `tools/project_io.py` as a long-running JSON-RPC child
  process and calls `parse_to_json` and `lint`.
* Contributes a **Project Spec** view to the Activity Bar with
  top-level nodes for **HLRs**, **LLRs**, **Tests**, **SDD**, and
  **STP**, each showing counts and expanding to children.
* Mirrors lint findings into the Problems panel as a
  `DiagnosticCollection` over `doc/Project.xml`.
* Provides a **Project Spec: Reveal in Project.xml** command on every
  tree node that points at a real `id`/`path`/`name` in the XML.

The extension is **strictly read-only** in this phase. There are no
commands that mutate `Project.xml`.

## Build

```bash
cd tools/vscode-project-xml
npm install
npm run build      # bundles to dist/extension.js
npm run compile    # type-check only
```

Open the folder in VS Code and press `F5` to launch an Extension
Development Host with this extension loaded against the parent
workspace.

## Settings

| Key | Default | Meaning |
| --- | --- | --- |
| `projectXml.xmlPath` | `doc/Project.xml` | Workspace-relative path to Project.xml. |
| `projectXml.xsdPath` | `tools/project.xsd` | Workspace-relative path to project.xsd. |
| `projectXml.toolsDir` | `tools` | Directory containing `project_io.py`. |
| `projectXml.pythonPath` | _(empty)_ | Override Python interpreter. Empty → `python3`, then `python`. |
| `projectXml.autoLintOnChange` | `true` | Re-lint on save. |
