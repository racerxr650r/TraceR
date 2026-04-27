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

With `doc/Project.xml` open in the editor, look just above each
`<hlr>`, `<llr>`, and `<test>` element. TraceR draws a row of small
clickable hints — things like *"2 LLRs / 4 tests"* over a
high-level requirement, or *"Traced from HLR-001"* over a test.

To use them:

1.  Open `doc/Project.xml`.
2.  Scroll to any HLR, LLR, or test. The hints appear as a thin
    grey line above the element.
3.  **Click a hint** to jump to the related items. If there's only
    one related item, the cursor jumps straight there. If there
    are several, a quick-pick list opens — pick one to jump.

What each hint means:

* **Coverage** (on `<hlr>` and `<llr>`) — counts how many
  downstream items trace back to this requirement (LLRs and tests
  for an HLR; tests for an LLR). Click to pick which downstream
  item to open.
* **Traces count** (on `<hlr>` and `<test>`) — counts incoming
  traces from the items above. Click to pick which upstream item
  to open.

The hints update automatically as you save. If you don't see them,
check that **Editor: Code Lens** is enabled in VS Code Settings
(`editor.codeLens` = `true`) — inline hints are implemented as
VS Code code lenses.

### Render and preview

TraceR ships two rendering commands. Both live under the
**Project Spec:** prefix in the Command Palette
(`Ctrl/Cmd+Shift+P`).

#### Preview a single document (no files written)

Use this while you're iterating — nothing on disk changes.

1.  Make sure you have a workspace open with `doc/Project.xml` in
    it. (Either of the two surfaces below also works without
    `Project.xml` open in the editor, but the workspace itself
    must contain it.)
2.  Open the Command Palette: **View → Command Palette…**, or
    `Ctrl+Shift+P` (Linux/Windows) / `Cmd+Shift+P` (macOS).
3.  Type **`Project Spec: Render & Preview`** and press Enter.
4.  A picker drops down titled *"Project Spec: render & preview"*
    with the placeholder *"Choose a generated document to
    preview"*. It lists every generated document declared in
    `Project.xml`, showing:
    * the document id on the left (e.g. `SDD`, `HLRs`, `LLRs`,
      `STP`, `Traceability`),
    * the document title in the middle,
    * the on-disk path it would write to on the right.
5.  Pick one and press Enter.
6.  TraceR renders the document in memory and opens it in VS
    Code's built-in Markdown preview, in a pane to the right of
    the editor. The address bar of that preview shows a
    `tracer-preview:` URL — that's how you can tell it's the
    in-memory render, not the file on disk.
7.  **Tip:** with **`projectXml.previewOnSave`** turned on (the
    default), every time you save `doc/Project.xml` the open
    preview re-renders against the new content. Just keep the
    preview open in a side pane while you edit.

If you want to refresh the preview manually without saving, click
the small refresh icon (↻) at the top of the preview tab, or
re-run **Render & Preview** for the same document.

If a render fails (for example, a template has an error), TraceR
shows the error in a notification toast and writes the details to
the **Project Spec** output channel — see *Where to look when
things go wrong* below.

#### Write all five documents to disk

Use this before you commit, so the rendered Markdown files in your
diff match the current `Project.xml`.

1.  Open the Command Palette (`Ctrl/Cmd+Shift+P`).
2.  Type **`Project Spec: Render All Documents`** and press Enter.
3.  A progress notification appears in the bottom-right of the
    window saying *"Project Spec: rendering all documents"*. It
    cycles through each document id as it renders.
4.  When the render finishes:
    * On success, you'll see *"Project Spec: rendered N documents."*
      The five files under `doc/` (`SDD.md`, `HLRs.md`, `LLRs.md`,
      `STP.md`, `Traceability.md`) are now refreshed on disk.
    * If anything failed, you'll see an error notification listing
      which document ids failed. Click the **Project Spec** entry
      in the *Output* panel (**View → Output**, then pick
      *Project Spec* from the dropdown) for the line-by-line log.
5.  Open the Source Control view to see the rendered files in your
    diff alongside `Project.xml` and commit them together.

There is no menu shortcut for these commands by default. If you
use them often, bind them to a keyboard shortcut via **File →
Preferences → Keyboard Shortcuts** (search for
`projectXml.renderAndPreview` or `projectXml.renderAll`).

#### Where to look when things go wrong

* **Notification toasts** appear in the bottom-right corner. Click
  one to see the full message.
* The **Project Spec** output channel logs every render
  attempt — open it via **View → Output**, then pick
  *Project Spec* from the dropdown on the right side of the panel.
* The **Problems panel** (**View → Problems**, or
  `Ctrl/Cmd+Shift+M`) shows lint findings against `Project.xml`
  itself; if a render fails because the project file is invalid,
  the underlying problem is usually listed there.

### Forms

Forms are the easiest way to add new items. Each form is generated
from the schema, so the fields you see always match what the
project file expects.

**To add a new item:**

1.  Open the **Project Spec** view in the activity bar.
2.  Right-click the appropriate category in the tree and pick the
    matching **Add…** command. The available commands are:

    | Right-click on…   | Pick…                  | Adds                                  |
    | ----------------- | ---------------------- | ------------------------------------- |
    | **HLRs**          | **Add HLR…**           | A new high-level requirement          |
    | **LLRs**          | **Add LLR…**           | A new low-level requirement           |
    | **SDD**           | **Add SDD Module…**    | A new design module                   |
    | **STP**           | **Add STP Fixture…**   | A new test fixture                    |
    | **Tests**         | **Add Test File…**     | A new source file containing tests    |
    | a test file       | **Add Test…**          | A new test inside that file           |

    The same commands are also available from the Command Palette
    under their **Project Spec:** prefix.

3.  A form panel opens beside the editor. The first ID field is
    pre-filled with the next free ID (e.g. `HLR-007`,
    `LLR-MOD-03`).
4.  Fill in the fields. Required fields are marked. Markdown is
    supported in description fields.
5.  Click **Submit**. TraceR validates the change against the
    schema and runs the linter:
    * If everything's clean, the change is written to
      `Project.xml`, comments and ordering are preserved, and the
      tree refreshes.
    * If the result has errors, nothing is written. The form shows
      what went wrong so you can correct it.

If `Project.xml` is open with unsaved changes when you submit,
TraceR will ask you to save or discard those changes first —
adding a new item only works against a clean copy on disk.

**To edit an existing item with a form:**

1.  Right-click the item in the tree.
2.  Pick **Edit in Form…**.
3.  The same form opens, pre-populated with the current values.
    Submit to apply the change (validated and lint-checked just
    like an add).

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
