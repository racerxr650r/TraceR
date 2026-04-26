# TraceR User Manual

## Overview

TraceR helps you keep your project's design, requirements, and tests
honest — and traceable to each other — without juggling a stack of
hand-edited Word documents.

You write your project once, in a single file (`doc/Project.xml`),
and TraceR turns it into a fully linked set of specification
documents:

* **Software Design Document** (`doc/SDD.md`)
* **High-Level Requirements** (`doc/HLRs.md`)
* **Low-Level Requirements** (`doc/LLRs.md`)
* **Software Test Plan** (`doc/STP.md`)
* **Traceability Matrix** (`doc/Traceability.md`) — shows which
  requirement maps to which test, in both directions.

You get TraceR in two flavors, and both work from the same project
file:

1.  **A VS Code extension.** This is the day-to-day experience: a
    side panel that lists your requirements and tests, instant
    error checking, click-through links between everything,
    fill-in-the-blank forms for adding new items, and (optionally)
    AI assistance for drafting and reviewing.
2.  **A small set of command-line tools.** The same engine,
    runnable from a terminal or a build script. Useful for
    continuous-integration checks, one-off renders, or just
    working without an editor open.

If your project lints clean from the command line, it lints clean
in the editor — and vice versa.

## Installation

### What you need

* **Python 3.10 or newer**, with the `Jinja2` package installed.
* *Optional but recommended:* the `lxml` Python package (or the
  `xmllint` tool from `libxml2-utils`). These give you stricter
  validation. TraceR still works without them.
* For the VS Code extension: **VS Code 1.90 or newer** and **Node.js
  20 LTS**.

On most systems:

```bash
# Python packages
pip install jinja2 lxml

# (Optional) xmllint on Debian/Ubuntu
sudo apt install libxml2-utils
```

### Installing the VS Code extension

The shipped `.vsix` file already includes a copy of TraceR's Python
tools, so the extension works in any folder as long as Python 3.10+
is on your PATH.

1.  Install the prerequisite XML extension from Red Hat:

    ```bash
    code --install-extension redhat.vscode-xml
    ```

2.  Install TraceR from the `.vsix`:

    ```bash
    code --install-extension tracer-project-xml-<version>.vsix
    ```

The first time you open an empty folder, the extension can scaffold
the `tools/` directory for you (see *Getting Started* below), so
your teammates and your CI server can use the command-line tools
even if they don't have the extension installed.

### Installing the command-line tools by themselves

If you only want the command-line tools (for example, on a build
server), clone the repository and use a Python virtual environment:

```bash
git clone https://github.com/racerxr650r/TraceR.git
cd TraceR
python3 -m venv .venv && source .venv/bin/activate
pip install jinja2 lxml
```

You don't need the extension for the CLI, and you don't need the
CLI for the extension.

## Getting Started

### Starting a brand-new project

The easiest path is the **Get Started with Project Spec** walkthrough
inside VS Code:

1.  Open an empty folder in VS Code.
2.  Pick **Help → Get Started → Project Spec**, or press
    `Ctrl/Cmd+Shift+P` and run **Project Spec: Show Walkthrough**.
3.  Follow the seven cards in order. They will:
    1.  Drop the `tools/` directory into your folder.
    2.  Create a starter `doc/Project.xml`.
    3.  Walk you through adding your first high-level requirement.
    4.  …and your first low-level requirement.
    5.  …and your first test.
    6.  Run the lint check.
    7.  Render all five spec documents.

By the end you have a working project and all five spec documents
under `doc/`.

If you'd rather do it from the command line:

```bash
python3 tools/render_doc.py --init \
    --name "MyProject" \
    --short-name MP \
    --author "Me" \
    --xml doc/Project.xml

python3 tools/render_doc.py --all   # renders all five spec docs
python3 tools/lint_project.py        # checks for problems
```

### Editing an existing project

Open the folder in VS Code. The **Project Spec** icon appears in
the activity bar (the strip on the far left). Click it to open the
Project Spec view. From there you can:

* **Click any item** in the tree to jump straight to it in
  `Project.xml`.
* **Right-click a category** (HLRs, LLRs, Tests, …) and pick
  **Add HLR**, **Add LLR**, **Add Test**, etc. A form appears;
  fill it in and submit.
* **Right-click any item** and use the AI menu (when AI is
  available) to draft, expand, review, or fix coverage gaps.
* **Save** the file. TraceR re-checks for problems and updates the
  side preview.

### What lives where

```
doc/
  Project.xml         <- the one file you actually edit
  SDD.md              <- generated, do not edit
  HLRs.md             <- generated, do not edit
  LLRs.md             <- generated, do not edit
  STP.md              <- generated, do not edit
  Traceability.md     <- generated, do not edit
tools/
  User_Manual.md      <- this document
  Developers_Guide.md <- for template authors and contributors
  …command-line tools and templates…
```

The five generated `*.md` files are rebuilt from `Project.xml`
every time you render. If you edit them by hand your changes will
be overwritten — change `Project.xml` instead.

## VS Code Extension

When the extension is active, you get the following surfaces. They
all stay in sync with `doc/Project.xml`.

### The Project Spec tree

The activity-bar tree groups your project by category:

* **HLRs** — High-Level Requirements, grouped by section.
* **LLRs** — Low-Level Requirements, grouped by function or module.
* **Tests** — your tests, grouped by source file.
* **SDD** — design document modules.
* **STP** — Software Test Plan fixtures.

Each item shows its ID and name. A small badge appears on items
with problems:

* ❌ — at least one error refers to this item.
* ⚠ — at least one warning refers to this item.

Click any item to reveal it in `Project.xml`.

### Problems and the status bar

TraceR re-checks `Project.xml` every time you save. Anything it
doesn't like shows up in the **Problems** panel, anchored to the
exact line. Common problems include:

* A trace that points at a requirement or section ID that doesn't
  exist.
* An ID that doesn't follow the expected pattern (for example,
  `HLR-1` instead of `HLR-001`).
* A requirement that has no test.
* A document declared in the metadata but missing its template
  file.

The status bar at the bottom of the window shows a live count of
errors and warnings. Click it to jump to the Problems panel.

### Quick Fixes

When the cursor is on a problem, a lightbulb appears. Quick Fixes
include:

| Problem                | What the Quick Fix does                          |
| ---------------------- | ------------------------------------------------ |
| Broken trace           | Replace the bad ID using a picker.               |
| Wrong ID format        | Renumber as the next free ID.                    |
| Missing template file  | Stub a starter template for you.                 |
| Requirement with no test | Insert a starter `<test>` block.               |

### Inline coverage hints

Above each requirement and test in `Project.xml`, TraceR shows tiny
inline hints — things like "2 LLRs / 4 tests" above a high-level
requirement, or "Traced from HLR-001" above a test. Click any hint
to jump to the related items.

### Render and preview

* **Project Spec: Render and Preview** opens a side-by-side preview
  of the affected document. The preview is in-memory and never
  overwrites the file on disk.
* **Project Spec: Render All** rewrites every generated document
  on disk in one go.
* You also get one **Render <DocName>** command per document.

If you have **Preview on Save** enabled (the default), the side
preview keeps itself in sync as you edit.

### Forms

Adding a new requirement, test, design module, or fixture pops up
a form. Behind the scenes, TraceR:

1.  Applies your edit to a working copy.
2.  Re-validates the result and re-runs the lint check.
3.  Saves the file **only if the result is clean** — comments,
    indentation, and ordering are preserved exactly.
4.  Shows you the problems if it isn't clean, and leaves the file
    untouched.

If the file is open with unsaved changes, TraceR will ask you to
save or discard before applying the form.

### AI assistance (optional)

When a language model is available in VS Code and AI is enabled in
settings, you also get:

* The **`@projectspec`** chat participant, with slash commands like
  `/draft-hlr`, `/draft-llr`, `/draft-test`, `/expand`, `/review`,
  `/suggest-traces`, and `/gap-fill`.
* **AI items** in the right-click menu of every Project Spec tree
  node, so you can draft or expand from the tree itself.
* A diff-preview-and-apply step on every AI suggestion: nothing
  ever lands in your file without you accepting the diff first.
  Each accepted change is also backed up to `.edit_doc/backups/`
  for safety.

If no model is available — or if you turn AI off — every AI
surface disappears cleanly and the rest of the extension keeps
working exactly as before.

### Resolving merge conflicts

If two branches edit `Project.xml` and Git can't merge them on its
own, run **Project Spec: Resolve Merge Conflicts**. TraceR will:

1.  Auto-merge the disjoint changes (different sections, different
    requirements added on each side, different traces, …).
2.  Open VS Code's three-way merge editor on whatever's left.
3.  When AI is on, badge per-region suggestions with a ✨.

TraceR never writes the merged file automatically — you commit
the result from the merge editor like any other merge.

### Useful settings

These live under **Settings → Extensions → Project Spec**:

| Setting                         | Default            | What it does                                                                 |
| ------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `projectXml.xmlPath`            | `doc/Project.xml`  | Path to the project file.                                                    |
| `projectXml.autoLintOnChange`   | `true`             | Re-check on save.                                                            |
| `projectXml.warningsAsErrors`   | `false`            | Treat warnings as errors in Problems and the status bar.                     |
| `projectXml.previewOnSave`      | `true`             | Refresh the side preview when the file is saved.                             |
| `projectXml.showCoverageBadges` | `true`             | Show ❌ / ⚠ badges on tree items.                                            |
| `projectXml.ai.enabled`         | `true`             | Turn AI surfaces on or off.                                                  |
| `projectXml.ai.modelFamily`     | _(empty)_          | Optional preferred model family (e.g. `gpt-4o`).                             |
| `projectXml.ai.autoApplyValidated` | `false`         | Skip the diff-preview step for AI patches that already passed validation.    |
| `projectXml.merge.enabled`      | `true`             | Enable structural merge for `Project.xml`.                                   |
| `projectXml.merge.aiResidualResolution` | `true`     | Use AI to suggest resolutions for residual merge conflicts.                  |

## Command Line Tools

The tools live in the `tools/` directory. Every script accepts
`--help`. Here are the ones you'll use most often.

### `render_doc.py` — generate the spec documents

```bash
# Regenerate every spec document.
python3 tools/render_doc.py --all

# Regenerate just one document by name.
python3 tools/render_doc.py tools/templates/HLRs.md.j2 HLRs --out doc/HLRs.md

# Bootstrap a brand-new project.
python3 tools/render_doc.py --init \
    --name "MyProject" --short-name MP --author "Me" \
    --xml doc/Project.xml
```

### `lint_project.py` — check for problems

```bash
python3 tools/lint_project.py
```

Exits with status `0` if everything is clean, non-zero if there
are any errors. Warnings are reported but don't fail the run
unless you pass `--warnings-as-errors`.

### `Makefile` — common tasks

The `tools/Makefile` ties the most common operations together:

```bash
make -C tools render        # re-render and check for drift
make -C tools lint          # run the linter
make -C tools validate-xml  # validate against the schema only
make -C tools test          # run the test suite
make -C tools ci            # render + lint + validate + test
```

This is what you'd normally wire into a continuous-integration
workflow.

## Example Workflow

Here's what a typical day with TraceR looks like once a project is
already set up.

1.  **Pull and open the project.**

    ```bash
    git pull
    code .
    ```

    The **Project Spec** icon appears in the activity bar.

2.  **Add a new requirement.** Right-click **HLRs** in the tree →
    **Add HLR**. The form pre-fills the next free ID. Fill in the
    name and description, then submit. TraceR validates the change
    and saves the file.

3.  **Break it down into low-level requirements.** Right-click the
    new HLR. If AI is available, pick **Expand with AI** — TraceR
    drafts a few candidate LLRs, with traces back to the parent
    HLR pre-filled. Review the diff and accept what looks right.
    Otherwise, pick **Add LLR** and fill the form yourself.

4.  **Add tests.** Right-click an LLR → **Add Test**, or ask the
    AI for `@projectspec /draft-test`. Tests inherit the LLR's
    traces automatically.

5.  **Render and review.** Save the file. The Problems panel
    should show `0 errors / 0 warnings`. The side preview shows
    the freshly rendered HLRs document. From a terminal you can
    also run:

    ```bash
    python3 tools/lint_project.py
    make -C tools render
    ```

6.  **Commit.** The five generated `*.md` files appear in the
    diff alongside `Project.xml`. Commit them together so reviewers
    see the rendered result.

7.  **Handle a merge conflict.** If a teammate edits
    `Project.xml` at the same time, run **Project Spec: Resolve
    Merge Conflicts** when Git complains. TraceR auto-merges the
    disjoint changes; whatever's left lands in the merge editor
    for you to decide.

That's the loop. For deeper details — the schema, the linter's
problem codes, how to add a new kind of generated document —
see the [Developer's Guide](Developers_Guide.md).
