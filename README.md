<p align="center">
  <img src="images/TraceR.png" alt="TraceR logo" width="200">
</p>

# TraceR

Vibe coding with AI doesn't have to be haphazard or even dangerous.

Is your software fielded in safety/certified environments requiring
certification audits? Or, do you simply want to improve and demonstrate
the quality of your software? Then you will benefit from a software
project traceability tool. **TraceR** turns a single
[`doc/Project.xml`](doc/Project.xml) — the single source of truth for
your project's design, requirements, and verification artefacts — into
a fully linked stack of specification documents:

* [Software Design Document](doc/SDD.md)
* [High-Level Requirements](doc/HLRs.md)
* [Low-Level Requirements](doc/LLRs.md)
* [Software Test Plan](doc/STP.md)
* [Traceability Matrix](doc/Traceability.md) (SDD → HLR → LLR → Test
  forward and reverse)

…and provides editor-native authoring with AI assistance to create and
maintain them.

## What ships in this repository

* A **VS Code extension** under
  [`tools/vscode-project-xml/`](tools/vscode-project-xml/) that
  contributes a structural Project Spec tree, lint diagnostics and
  status-bar coverage, code lenses with click-through, schema-driven
  form panels for every payload, an `@projectspec` AI chat
  participant with grounded slash commands, and a deterministic +
  AI-assisted three-way merge resolver for `doc/Project.xml`.
* A **Python command-line toolchain** under [`tools/`](tools/) — the
  same engine the extension shells out to. Use it standalone from a
  Makefile or CI without VS Code.
* A **canonical XSD** ([`tools/project.xsd`](tools/project.xsd)) that
  both surfaces validate against and read UI hints from.
* The **TraceR project's own** PVD, SDP, SDD, HLRs, LLRs, STP, and
  Traceability Matrix — i.e. TraceR is built using TraceR.

## Installation

### VS Code extension (recommended)

1. Go to the
   [Releases](https://github.com/racerxr650r/TraceR/releases) page
   and download the `.vsix` file attached to the latest release
   (e.g. `vscode-project-xml-0.2.0.vsix`).

2. Install the extension using **one** of these methods:

   **From the command line:**

   ```bash
   code --install-extension vscode-project-xml-*.vsix
   ```

   **From VS Code:**

   Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), run
   **Extensions: Install from VSIX…**, and select the downloaded
   file.

3. Reload VS Code when prompted. The extension activates
   automatically when it detects a `doc/Project.xml` in the open
   workspace.

> **Tip:** The `.vsix` is self-contained — it bundles the Python
> sidecar toolchain so you can start authoring immediately. For
> CLI and CI use, run the **Project Spec: Scaffold tools/ into
> workspace…** command to copy the toolchain into your project.

### Python CLI toolchain (standalone)

If you only need the command-line tools (lint, render, edit) without
the VS Code extension:

```bash
git clone https://github.com/racerxr650r/TraceR.git
cd TraceR
make -C tools bootstrap   # creates .venv with all dependencies
```

Then use the tools directly:

```bash
.venv/bin/python tools/lint_project.py --xml doc/Project.xml --xsd tools/project.xsd
.venv/bin/python tools/render_doc.py tools/templates/HLRs.md.j2 HLRs --xml doc/Project.xml --out doc/HLRs.md
```

See [`tools/User_Manual.md`](tools/User_Manual.md) for full CLI
usage.

## Where to start

| You are… | Read… |
|----------|-------|
| **Evaluating TraceR** for your project | [`doc/PVD.md`](doc/PVD.md) — Product Vision Document (problem, audience, success metrics, baseline vs. AI-graceful behaviour). |
| **Installing and using** TraceR | [`tools/User_Manual.md`](tools/User_Manual.md) — install, getting started, VS Code extension, CLI tools, end-to-end example workflow. |
| **Authoring templates** or **contributing** to TraceR | [`tools/Developers_Guide.md`](tools/Developers_Guide.md) — schema reference, renderer data surface, linter contract, recipe for adding a new generated document. |
| Tracking the **roadmap** and per-phase delivery state | [`doc/SDP.md`](doc/SDP.md) — Software Development Plan (phased VS Code extension roadmap with the live Status table). |

## License

See [LICENSE](LICENSE).
