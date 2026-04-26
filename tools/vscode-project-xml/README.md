# Project Spec (TraceR)

Structured authoring, validation, and traceability views for
[TraceR's](https://github.com/racerxr650r/TraceR)
`doc/Project.xml` — the single source of truth for your project's
design, requirements, and verification artefacts.

## Features

* **Project Spec activity-bar tree** — browse HLRs, LLRs, Tests,
  SDD modules, and STP fixtures grouped by category. Click any
  item to reveal it in `Project.xml`.
* **Live problem detection** — every save re-checks for broken
  traces, malformed IDs, untested requirements, and missing
  templates. Findings appear in the Problems panel with a status-bar
  count.
* **Quick Fixes** — lightbulb actions for broken traces (with an
  ID picker), wrong-format IDs, missing templates, and
  requirements with no test.
* **Inline coverage hints** — code lenses above each requirement
  and test show counts of downstream LLRs / tests and incoming
  traces, with click-through navigation.
* **Schema-driven forms** — *Add HLR / Add LLR / Add Test / Add
  SDD Module / Add STP Fixture* commands open a form derived from
  the schema; submissions are validated and lint-checked before
  the file is written.
* **Render and preview** — *Render and Preview* opens a side
  preview of the rendered Markdown for any of the five generated
  documents; *Render All* writes them to disk.
* **AI assistance (optional)** — when a language model is
  available, the `@projectspec` chat participant offers slash
  commands (`/draft-hlr`, `/draft-llr`, `/draft-test`, `/expand`,
  `/review`, `/suggest-traces`, `/gap-fill`, `/resolve-conflicts`)
  and a right-click AI menu on every Project Spec tree node. Every
  AI suggestion goes through a diff-preview-and-apply gate;
  nothing lands without your acceptance.
* **Three-way merge resolution** — *Project Spec: Resolve Merge
  Conflicts* runs a structural three-way merger on `Project.xml`
  that preserves comments, CDATA, and ordering, and surfaces
  residual conflicts in VS Code's merge editor (with optional AI
  suggestions).
* **Self-contained** — the `.vsix` ships its own copy of the
  Python toolchain. The first time you open an empty folder, the
  *Project Spec: Scaffold tools/ into workspace…* command can drop
  the toolchain into your project so the CLI and CI pipelines work
  too.

## Requirements

* **VS Code** 1.85 or newer.
* **Python** 3.10 or newer on your PATH.
  [Jinja2](https://pypi.org/project/Jinja2/) is required;
  [lxml](https://pypi.org/project/lxml/) (or the `xmllint` binary)
  is recommended for stricter validation.
* The
  [Red Hat XML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-xml)
  (declared as an extension dependency; VS Code installs it
  automatically).

## Getting Started

1.  Open a folder in VS Code (empty is fine).
2.  Pick **Help → Get Started → Project Spec**, or run **Project
    Spec: Show Walkthrough** from the Command Palette.
3.  Follow the seven cards: scaffold `tools/`, initialise
    `Project.xml`, add your first HLR, LLR, and Test, run the
    linter, and render all five spec documents.

For full usage details see the
[User Manual](https://github.com/racerxr650r/TraceR/blob/main/tools/User_Manual.md).
For the schema, template-author guide, and contributor reference
see the
[Developer's Guide](https://github.com/racerxr650r/TraceR/blob/main/tools/Developers_Guide.md).

## Settings

| Key                                | Default            | Description                                                                  |
| ---------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `projectXml.xmlPath`               | `doc/Project.xml`  | Workspace-relative path to the project file.                                 |
| `projectXml.xsdPath`               | `tools/project.xsd`| Workspace-relative path to the schema.                                       |
| `projectXml.toolsDir`              | `tools`            | Directory containing `project_io.py`. Falls back to the bundled copy.        |
| `projectXml.pythonPath`            | _(empty)_          | Override the Python interpreter (defaults to `python3` then `python`).       |
| `projectXml.autoLintOnChange`      | `true`             | Re-lint on save.                                                             |
| `projectXml.warningsAsErrors`      | `false`            | Treat warnings as errors in Problems and the status bar.                     |
| `projectXml.previewOnSave`         | `true`             | Refresh the side preview when the project file is saved.                    |
| `projectXml.showCoverageBadges`    | `true`             | Show ❌ / ⚠ badges on tree items with problems.                              |
| `projectXml.ai.enabled`            | `true`             | Turn the AI surfaces on or off.                                              |
| `projectXml.ai.modelFamily`        | _(empty)_          | Optional preferred language-model family.                                    |
| `projectXml.ai.autoApplyValidated` | `false`            | Skip the diff-preview gate for AI patches that already passed validation.    |
| `projectXml.merge.enabled`         | `true`             | Enable structural three-way merge for `Project.xml`.                         |
| `projectXml.merge.aiResidualResolution` | `true`        | Use AI to suggest resolutions for residual merge conflicts.                  |

## License

[MIT](LICENSE).
