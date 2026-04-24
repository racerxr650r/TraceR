# Software Development Plan Document (SDP): VS Code Extension for Project.xml Authoring

**Status:** Baseline product (per [PVD §5, §7.1](PVD.md))
**Owner:** TBD
**Target deliverable:** `tools/vscode-project-xml/` — a VS Code
extension (publishable as a `.vsix`, optionally to the Marketplace)
that provides a structured editor, custom views, validation, a
guided-authoring experience, AI-assisted authoring, and AI-assisted
merge resolution for `doc/Project.xml` directly inside the editor the
developer is already in.

### Relationship to the PVD

This plan is the implementation of four baseline capabilities called
out in [doc/PVD.md](PVD.md):

*   **In-editor authoring** ([PVD §5 #5](PVD.md), [§7.1](PVD.md)) —
    structured tree, diagnostics, code lenses, form panels, walkthrough.
    Covered by Phases 1–4.
*   **Schema-driven surfaces** ([PVD §5 #5](PVD.md),
    [§6 #11](PVD.md), [§7.1](PVD.md), [§8](PVD.md)) — the tree,
    forms, code lenses, preview targets, and `Render <Doc>` commands
    are built at runtime from `tools/project.xsd` UI hints
    (`xs:appinfo`) and the `<metadata><document>` list, so adding a
    new generated document or payload section requires zero
    TypeScript changes. Covered by **Phase 2.5** (the retrofit that
    replaces the hard-coded Phase 1–2 surfaces with schema-driven
    equivalents) and inherited by Phases 3–4.
*   **AI-assisted authoring** ([PVD §5 #6](PVD.md), [§6 #7](PVD.md),
    [§7.1](PVD.md)) — `@projectspec` chat participant, slash
    commands, grounded prompts, typed responses, validate→retry,
    diff preview, provenance log. Covered by Phase 5.
*   **Structured merge resolution** ([PVD §5 #7](PVD.md),
    [§7.1](PVD.md)) — deterministic structural merge plus
    AI-mediated residual resolution. Covered by Phase 5.5.

All four are required for v1.0; none are optional roadmap items.
The success metric **"AI-grounded authoring"** in [PVD §8](PVD.md)
(>90% schema-valid first response, validator-feedback retry, never
silently applied) is the acceptance bar for Phase 5; the
**"Schema-driven extensibility"** metric in [PVD §8](PVD.md) (a new
doc/payload addable with zero TS changes) is the acceptance bar for
Phase 2.5; and the [PVD §6 #7](PVD.md) principle ("AI as a
co-author, not an oracle: grounded, validated, diff-previewed,
logged") is the design contract for §5.8 and §5.9.

## 0. Required Tools for Development

The following toolchain is the supported developer environment for
building, testing, packaging, and publishing this extension. CI runs
the same versions; mismatches between local and CI are a release
blocker.

| Tool | Minimum version | Purpose |
| ---- | --------------- | ------- |
| **Python** | 3.10 | Runs `tools/render_doc.py`, `tools/lint_project.py`, `tools/project_io.py`, `tools/project_merge.py`, and the `tools/ai/` pipeline. The extension shells out to the user's interpreter — no bundled runtime. |
| **Jinja2** | 3.x | Required by the renderer. Installed via `pip install jinja2`. |
| **lxml** *or* **xmllint** | any | Optional XSD validator used by the linter; lint degrades gracefully when neither is present. Recommended in CI for strict validation. |
| **Node.js** | 20 LTS | Builds the TypeScript extension and the webview bundles (forms, walkthrough, diff preview). |
| **npm** | 10 | Bundled with Node 20; used for dependency management under `tools/vscode-project-xml/`. |
| **TypeScript** | 5.x | Source language for `tools/vscode-project-xml/src/`. Installed via `npm install` from the local `package.json`. |
| **esbuild** | 0.20+ | Bundler for the extension and webviews (see `esbuild.config.js`). Installed via `npm install`. |
| **VS Code** | 1.90+ | Required for the Chat Participant API used in Phase 5 (`vscode.chat.createChatParticipant`). |
| **`@vscode/vsce`** | 2.x | Packages and (optionally) publishes the `.vsix`. Installed globally or via `npx vsce`. |
| **Red Hat XML extension** (`redhat.vscode-xml`) | latest | Declared as `extensionDependencies`; provides syntax, outline, and XSD-backed completion that this extension layers on top of. |
| **Git** | 2.30+ | Required by Phase 5.5 for `git show :1:`/`:2:`/`:3:` blob retrieval during three-way merge resolution. |
| **GitHub CLI** (`gh`) | optional | Convenience for releasing tags that trigger the `.vsix` publish workflow. |

### Bootstrapping a fresh checkout

```sh
# Python side
python3 -m venv .venv && source .venv/bin/activate
pip install jinja2 lxml pytest

# Extension side
cd tools/vscode-project-xml
npm install
npm run build      # esbuild bundle
code --extensionDevelopmentPath=$PWD .
```

The Phase 0 sidecar (`tools/project_io.py`) and the linter must run
on the same Python interpreter the extension will spawn at runtime;
configure `projectXml.pythonPath` in VS Code settings if the default
`python3` does not point at the venv.

### Installation by platform

The commands below install the **system-level** prerequisites (Python,
Node.js, Git, GitHub CLI, optional XSD validator). After running the
platform block for your OS, return to *Bootstrapping a fresh checkout*
above to install the per-project Python and Node dependencies via
`pip` and `npm`, and to install the **VS Code extension dependency**
[Red Hat XML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-xml)
from the VS Code Marketplace (or with `code --install-extension
redhat.vscode-xml`).

#### Debian / Ubuntu (apt)

```sh
# Python 3.10+, venv, pip
sudo apt update
sudo apt install -y python3 python3-venv python3-pip

# Optional XSD validator (xmllint ships in libxml2-utils)
sudo apt install -y libxml2-utils                    # xmllint
# or, for the lxml Python binding instead of xmllint:
#   pip install lxml         (inside the project venv)

# Node.js 20 LTS via NodeSource (the apt 'nodejs' package is older)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs                           # bundles npm 10

# Git, GitHub CLI
sudo apt install -y git
sudo apt install -y gh                               # add 'cli/cli' apt repo
                                                     # if 'gh' is unavailable

# VS Code (Microsoft apt repo)
sudo apt install -y wget gpg
wget -qO- https://packages.microsoft.com/keys/microsoft.asc \
    | gpg --dearmor | sudo tee /usr/share/keyrings/packages.microsoft.gpg >/dev/null
echo "deb [arch=amd64,arm64,armhf signed-by=/usr/share/keyrings/packages.microsoft.gpg] \
https://packages.microsoft.com/repos/code stable main" \
    | sudo tee /etc/apt/sources.list.d/vscode.list >/dev/null
sudo apt update && sudo apt install -y code

# vsce (extension packager) — install globally with npm, or use `npx vsce`
sudo npm install -g @vscode/vsce
```

#### Fedora / RHEL / CentOS Stream (dnf)

```sh
# Python 3.10+, venv, pip
sudo dnf install -y python3 python3-pip

# Optional XSD validator
sudo dnf install -y libxml2                          # xmllint
# or, for the lxml Python binding:
#   pip install lxml         (inside the project venv)

# Node.js 20 LTS — Fedora 39+ has it in the default repos:
sudo dnf install -y nodejs npm
# On RHEL / older Fedora, use the NodeSource setup script instead:
#   curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash -
#   sudo dnf install -y nodejs

# Git, GitHub CLI
sudo dnf install -y git
sudo dnf install -y gh                               # enable 'cli/cli' COPR
                                                     # repo on RHEL if needed

# VS Code (Microsoft yum repo — matches the official setup snippet at
# https://code.visualstudio.com/docs/setup/linux#_rhel-fedora-and-centos-based-distributions)
sudo rpm --import https://packages.microsoft.com/keys/microsoft.asc
sudo tee /etc/yum.repos.d/vscode.repo >/dev/null <<'EOF'
[code]
name=Visual Studio Code
baseurl=https://packages.microsoft.com/yumrepos/vscode
enabled=1
autorefresh=1
type=rpm-md
gpgcheck=1
gpgkey=https://packages.microsoft.com/keys/microsoft.asc
EOF
dnf check-update                                     # exits non-zero by design
sudo dnf install -y code                             # use 'yum' on RHEL 7

# vsce
sudo npm install -g @vscode/vsce
```

#### Arch / Manjaro (pacman)

```sh
# Python 3.10+, pip
sudo pacman -S --needed python python-pip

# Optional XSD validator
sudo pacman -S --needed libxml2                      # xmllint
# or, for the lxml Python binding:
#   pip install lxml         (inside the project venv; or `pacman -S python-lxml`)

# Node.js 20 LTS, npm
sudo pacman -S --needed nodejs-lts-iron npm          # Node 20 LTS ('Iron')

# Git, GitHub CLI
sudo pacman -S --needed git github-cli

# VS Code — open-source 'code' package, or 'visual-studio-code-bin' from AUR
sudo pacman -S --needed code                         # OSS build (Code - OSS)
# Microsoft-branded build:
#   yay -S visual-studio-code-bin                    # AUR helper required

# vsce
sudo npm install -g @vscode/vsce
```

#### macOS (Homebrew)

```sh
# Install Homebrew first if you do not have it:
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Python 3.10+ (macOS system Python is usually too old or absent)
brew install python@3.12

# Optional XSD validator
brew install libxml2                                 # provides xmllint
# or, for the lxml Python binding:
#   pip install lxml         (inside the project venv)

# Node.js 20 LTS, npm
brew install node@20
brew link --overwrite --force node@20                # if a different node is linked

# Git, GitHub CLI
brew install git
brew install gh

# VS Code (cask) — or download the .dmg from https://code.visualstudio.com
brew install --cask visual-studio-code

# vsce
npm install -g @vscode/vsce
```

#### Verification

Run after any of the platform blocks above to confirm the toolchain
satisfies the minimums in the table:

```sh
python3 --version          # >= 3.10
node --version             # >= v20
npm --version              # >= 10
code --version             # >= 1.90.0
git --version              # >= 2.30
gh --version               # optional
xmllint --version 2>&1 \
    | head -n1             # optional XSD validator (or `python3 -c "import lxml"`)
```

## 1. Why a VS Code Extension Instead of (or Alongside) the Web Form

The web form (see [PLAN_web_form.md](../tools/PLAN_web_form.md)) is the right
answer for non-developer contributors. The extension is the right
answer for the developer audience this project actually has today,
because:

*   Zero context switch — the spec lives next to the code.
*   The user's existing Source Control panel handles diff/commit/
    history.
*   VS Code already has best-in-class XML support via the Red Hat
    extension; we layer on top of it instead of rebuilding.
*   Custom Tree Views, Code Lenses, Diagnostics, and Webview Panels
    cover every interaction the web form needs.
*   Distribution is `code --install-extension`; no localhost server.

The two tools share the **same backend logic** — both call
`tools/render_doc.py` and `tools/lint_project.py`. The extension is
"the IDE-native shell"; the web form is "the standalone shell".

## 2. Goals

1.  **First-class structural view** of `Project.xml` in the Explorer
    side bar (HLRs / LLRs / Tests / SDD / STP trees).
2.  **Inline diagnostics** for every error/warning surfaced by
    `lint_project.py`, with quick fixes where applicable.
3.  **Code Lenses** above each `<hlr>`, `<llr>`, and `<test>` showing
    coverage status and click-through to related items.
4.  **Form panels** (webviews) for editing complex payloads (a single
    HLR, a single test, an SDD module) without scrolling 1500-line XML.
5.  **Live preview** — render the affected spec markdown into a side
    preview pane on save.
6.  **Guided authoring** — a Walkthrough (the same UI as VS Code's
    "Get Started" tab) that steps the user through bootstrapping a new
    project and filling each payload in order.
7.  **Inline AI assistance** — a Copilot Chat participant
    (`@projectspec`) plus right-click "Draft with AI" actions on every
    payload type. The AI is constrained by the XSD and grounded in the
    PVD/SDD/upstream payloads, so generated HLRs/LLRs/tests are
    schema-valid, traceable, and consistent with what the user has
    already written. Realises the [PVD §6 #7](PVD.md) principle
    "AI as a co-author, not an oracle".
8.  **AI-assisted merge resolution** — `Project.xml` merge conflicts
    are resolved by a deterministic structural merger first, with the
    AI layer used only for residual semantic conflicts. Realises the
    [PVD §5 #7](PVD.md) baseline value proposition.
9.  **Commands for everything** — every action discoverable via the
    Command Palette.

## 3. Non-Goals

*   Re-implement XML syntax highlighting / outline / autocomplete —
    delegate to the Red Hat XML extension (declared as `extensionDependencies`).
*   Edit `doc/PVD.md` as structured data — open it as plain markdown.
*   Bundle a Python interpreter — we shell out to the user's Python
    via `python.defaultInterpreterPath` (or a configured one).
*   Ship our own LLM client or API keys. AI features layer on top of
    the Language Model API the user has already enabled
    (`vscode.lm.*` / Copilot Chat). When those APIs are unavailable,
    AI surfaces hide themselves cleanly and the deterministic
    surfaces (tree, diagnostics, lenses, forms, render, Stage A merge)
    keep working — this is the [PVD §7.1](PVD.md) graceful
    degradation contract, not a fallback nicety.

## 4. Design — see the SDD

Every component this plan delivers is documented in detail in the
Software Design Document, which is generated from the `<sdd>`
payload of `doc/Project.xml`. To avoid duplication and drift
([PVD §6 Principle 1](PVD.md): single source of truth), this plan
intentionally does **not** repeat the architecture, the per-surface
designs, the data model, the settings reference, or the repository
layout. Each is owned by exactly one section of the SDD.

When working on this plan, consult the SDD for the *what* and the
*how* of each component:

| What you need | Where to read it |
| ------------- | ---------------- |
| System architecture diagram and component list | [SDD §2.1 System Architecture](SDD.md#21-system-architecture) |
| Cross-cutting design goals (mapped to PVD principles) | [SDD §2.2 Design Goals and Constraints](SDD.md#22-design-goals-and-constraints) |
| End-to-end authoring flow | [SDD §2.1](SDD.md#21-system-architecture) (System Architecture, flow steps) |
| Renderer (`tools/render_doc.py`) | [SDD §4 Detailed Design](SDD.md) |
| Linter (`tools/lint_project.py`) | [SDD §5 Detailed Design](SDD.md) |
| Templates (`tools/templates/`) | [SDD §7 Detailed Design](SDD.md) |
| JSON-RPC sidecar (`tools/project_io.py`) | [SDD §8 Detailed Design](SDD.md) |
| Three-way structural merger (`tools/project_merge.py`) | [SDD §9 Detailed Design](SDD.md) |
| AI grounding & validate→retry pipeline (`tools/ai/`) | [SDD §10 Detailed Design](SDD.md) |
| VS Code extension top-level | [SDD §11 Detailed Design](SDD.md) |
| Tree view, diagnostics, code lenses, form panels, walkthrough, AI participant | [SDD §12–17](SDD.md) (one section per surface) |
| Data dictionary (parsed-tree types, lint findings, UI-hint registry, JSON Patch, AI bundle, merge conflicts) | [SDD §19 Data Dictionary](SDD.md) |
| Authoritative `projectXml.*` settings list and defaults | [SDD §19 Data Dictionary](SDD.md), "Compile-time constants" sub-table |
| Traceability themes (PVD principle → SDD section mapping) | [SDD §20 Traceability](SDD.md) |

The SDD section numbers above are 1-based and reflect the current
rendered output; they shift if modules are added or removed. Always
link back to the SDD by **section title** when stable text is
important.

---

## 8. Phased Delivery

### Phase 0 — Sidecar foundations
1.  Refactor `render_doc.py` and `lint_project.py` to expose
    importable functions (same prerequisite as the web-form plan).
2.  Build `tools/project_io.py` with `lint`, `render`,
    `parse_to_json`, `init_project` over stdio JSON-RPC.
3.  Acceptance: `echo '{"method":"lint"}' | python3 tools/project_io.py`
    returns the same findings as `tools/lint_project.py`.

**AI prompt:**
> Refactor `tools/render_doc.py` and `tools/lint_project.py` so their
> core behaviour is callable as Python functions (no `sys.argv`, no
> `print`, no `sys.exit` in the library paths) while keeping their
> existing CLI entry points working unchanged. Then create
> `tools/project_io.py`: a long-running JSON-RPC 2.0 server over
> stdin/stdout that exposes `lint`, `render`, `parse_to_json`, and
> `init_project` methods backed by those refactored functions. Add
> tests under `test/` that exercise both the importable functions and
> the JSON-RPC surface. Do not change any output format that
> downstream tooling depends on.

### Phase 1 — Read-only extension
1.  Generate the manifest, declare `extensionDependencies` on the
    Red Hat XML extension.
2.  Tree View showing HLRs / LLRs / Tests with counts.
3.  Diagnostics provider wired to `projectXml.lint` command.
4.  Reveal-in-XML for each tree node.
5.  Acceptance: install extension in a VS Code instance, open this
    repo, see the Project Spec view populated and lint findings in
    the Problems panel.

**AI prompt:**
> Scaffold a TypeScript VS Code extension under
> `tools/vscode-project-xml/` that depends on the Red Hat XML
> extension. Spawn `tools/project_io.py` as a long-running child
> process and call its `parse_to_json` and `lint` methods. Implement a
> `TreeDataProvider` that contributes a "Project Spec" view to the
> Activity Bar with top-level nodes for HLRs, LLRs, Tests, SDD, and
> STP, each showing counts. Implement a `DiagnosticCollection` that
> mirrors lint findings into the Problems panel with accurate ranges
> in `Project.xml`. Wire up a "Reveal in XML" command on each tree
> node. The extension must be strictly read-only in this phase — no
> commands that mutate `Project.xml`.

### Phase 2 — Code Lenses + Render
1.  CodeLensProvider over `Project.xml`.
2.  `Render & Preview` command with markdown preview pane.
3.  `Render All` command.
4.  Acceptance: clicking a Code Lens link jumps to the correct LLR;
    saving the file (with `previewOnSave: true`) updates the preview.

**AI prompt:**
> Add a `CodeLensProvider` to the extension that decorates every
> `<hlr>`, `<llr>`, and `<test>` element in `Project.xml` with
> coverage status (e.g. "3 LLRs · 5 tests") plus click-through
> commands that jump to each related element. Add a
> `projectXml.renderAndPreview` command that calls the sidecar's
> `render` method for the affected document and opens the result in a
> side-by-side Markdown preview, and a `projectXml.renderAll` command
> that regenerates every spec under `doc/`. Honour the
> `projectXml.previewOnSave` setting. Keep all rendering in the
> sidecar — do not reimplement template logic in TypeScript.

### Phase 2.5 — Schema-driven retrofit

**Why this phase exists.** Phases 1 and 2 ship hard-coded surfaces
(tree nodes for HLRs/LLRs/Tests/SDD/STP, code lenses keyed on those
five element names, render commands enumerating a fixed list of
document ids). The PVD update of 2026-04 introduced [Principle 11
"Schema-driven surfaces"](PVD.md) and the
["Schema-driven extensibility" success metric](PVD.md), which
require that adding a new generated document, a new payload
section, or a new field be a schema-and-template change — not a
TypeScript change. This phase retrofits the Phase 1–2 surfaces to
that contract before Phase 3's form panels lock in any further
hard-coded payload assumptions.

1.  **UI-hint vocabulary in the XSD.** Define a small `xs:appinfo`
    vocabulary under a dedicated namespace (e.g.
    `xmlns:ui="https://tracer.dev/ui/1"`) covering at minimum:
    *   `ui:treeNode label="@name|@id" idAttr="id" group="..."`
        — element appears in the Project Spec tree.
    *   `ui:form field="text|textarea|enum|ref:HLR|ref:LLR|cdata"`
        on each editable attribute / child element.
    *   `ui:lens kind="coverage|tracesCount|custom:<name>"` —
        which code lens to attach.
    *   `ui:document id="..."` on `metadata/document` to mark which
        ids are renderable targets.
    Document the vocabulary in
    [Schema_Reference.md](Schema_Reference.md)
    alongside the existing schema reference. Bump
    `<project schema_version>` to reflect the additive change.
2.  **Generic JSON projection.** Replace the hand-typed
    `ParsedSdd` / `ParsedHlr` / `ParsedLlr` / `ParsedStp` interfaces
    in `tools/vscode-project-xml/src/sidecar.ts` with a generic
    `ParsedNode { tag, attrs, text?, children: Record<string,
    ParsedNode[]> }`. Extend `tools/project_io.py`'s
    `parse_to_json` to emit this shape plus an inline
    `ui_hints_index` derived from the XSD so the TypeScript side
    never re-parses the schema.
3.  **Generic tree provider.** Rewrite
    `src/treeView/ProjectSpecProvider.ts` to walk
    `ui_hints_index.treeNodes` instead of calling `buildHlrsNode` /
    `buildLlrsNode` / `buildSddNode` / `buildStpNode` /
    `buildTestsNode`. The five hard-coded builders are deleted; the
    same view rebuilds itself when the schema declares a new
    top-level node.
4.  **Generic locator.** Rewrite `src/util/locator.ts` so it takes
    `(elementName, idAttr, idValue)` from the hint registry rather
    than special-casing HLR/LLR/test/module element names.
5.  **Generic code lenses.** Replace the Phase 2 lens provider's
    fixed `<hlr>`/`<llr>`/`<test>` selectors with one driven by
    `ui_hints_index.lenses`; the existing coverage and
    traces-count computations move into named lens kinds that any
    new payload can opt into via `ui:lens`.
6.  **Schema-driven document discovery.** The Phase 2
    `projectXml.renderAndPreview`, `projectXml.renderAll`, and
    Markdown-preview commands enumerate `<metadata><document>`
    entries (filtered by `ui:document`) instead of a hard-coded
    list of `SDD|HLRs|LLRs|STP|Traceability`. The Command Palette
    contributes one `Render <Doc>` command per discovered document
    via `package.json`'s dynamic command activation, populated at
    activation time from a sidecar `list_documents` call.
7.  **Linter alignment.** Change `tools/lint_project.py`'s
    `STANDARD_DOCS` set into a function that returns the document
    ids declared in `<metadata><document>`; the existing
    "required document missing" check becomes "any document id
    referenced by a template under `tools/templates/` must have a
    matching `<metadata><document>`". Templates discovered under
    `tools/templates/` define the required set; the hard-coded
    five-doc set is removed.
8.  **Acceptance.** Add a synthetic `<plan>` payload to a fixture
    `Project.xml` plus a `tools/templates/Plan.md.j2` template and
    a `<metadata><document id="Plan">` entry. With **zero**
    TypeScript changes, the extension must:
    *   Show a `Plan (n phases)` node in the Project Spec tree.
    *   Offer a `Render Plan` command in the Command Palette.
    *   Open the rendered `Plan.md` in the side preview.
    *   Lint cleanly with no "unknown document" or "unknown
        element" findings.
    *   Reveal-in-XML must work for the new tree nodes via the
        generic locator.
9.  **Carry-forward contract for Phases 3–6.** From this point on,
    every new surface (form panels, walkthrough steps, AI intents,
    merge intents, status bar) consults the hint registry rather
    than naming payload elements directly. Bespoke widgets and
    domain-specific lint rules remain the only payload-aware code
    paths, as required by [PVD §6 #11](PVD.md).

**AI prompt:**
> Retrofit the Phase 1–2 surfaces of `tools/vscode-project-xml/`
> to be schema-driven, per [PVD §6 #11](PVD.md) and the
> "Schema-driven extensibility" success metric. First, extend
> `tools/project.xsd` with an `xs:appinfo` UI-hint vocabulary
> (`ui:treeNode`, `ui:form`, `ui:lens`, `ui:document`) under a
> dedicated namespace, document it in
> `Schema_Reference.md`, and bump `schema_version`. Extend
> `tools/project_io.py`'s `parse_to_json` to emit a generic
> `ParsedNode` tree plus a `ui_hints_index` distilled from the
> XSD, and add a `list_documents` method enumerating
> `<metadata><document>` entries. On the TypeScript side, replace
> the hand-typed `ParsedSdd`/`ParsedHlr`/etc. interfaces with one
> generic `ParsedNode`; rewrite `ProjectSpecProvider`, the lens
> provider, and `util/locator.ts` to walk the hint registry
> instead of calling per-payload builders; and replace the
> hard-coded render command list with one `Render <Doc>` command
> per discovered document, registered dynamically at activation.
> On the linter side, derive `STANDARD_DOCS` from the templates
> under `tools/templates/` rather than a hard-coded set. Prove the
> retrofit by adding a synthetic `<plan>` payload, a
> `tools/templates/Plan.md.j2` template, and a
> `<metadata><document id="Plan">` entry to a fixture
> `Project.xml`, and showing that the extension picks up a `Plan`
> tree node, a `Render Plan` command, a Markdown preview, and
> clean lint output with **zero** TypeScript changes after the
> retrofit lands. Carry the schema-driven contract forward into
> Phases 3–6: no new surface may name a payload element directly.

### Phase 3 — Form webview for HLRs and LLRs
1.  Single-item form panel with RJSF.
2.  JSON Patch round-trip via sidecar.
3.  Add-new commands for HLR and LLR.
4.  Quick fixes for "broken trace" and "id format" diagnostics.
5.  Acceptance: add a new HLR via the form, see it appear in the
    XML, in the tree, and in the rendered HLRs.md preview.

**AI prompt:**
> Implement the first interactive surface: a Webview-based form
> panel that edits a single `<hlr>` or `<llr>` using
> [react-jsonschema-form](https://rjsf-team.github.io/react-jsonschema-form/)
> driven by a JSON Schema derived from `tools/project.xsd`. The form
> sends a JSON Patch through the sidecar, which writes back to
> `Project.xml` while preserving formatting and comments. Add
> `projectXml.addHlr` and `projectXml.addLlr` commands that open a
> blank form. Implement `CodeActionProvider` quick fixes for the
> "broken trace ref" and "id format" diagnostics from `lint_project`.
> Handle the case where the underlying XML is dirty in a text editor
> by prompting the user before applying the patch.

### Phase 4 — SDD/STP/Test forms + Walkthrough
1.  Module/test/fixture form variants.
2.  Walkthrough contribution with all seven steps.
3.  Init-project command flow that drives `render_doc.py --init`.
4.  Acceptance: from an empty repo, a user can install the
    extension, run the Walkthrough, and end up with a populated
    Project.xml plus all five rendered spec docs.

**AI prompt:**
> Extend the Phase 3 form infrastructure with form variants for SDD
> modules, STP entries, test files, and individual `<test>` elements,
> reusing the same JSON-Patch-via-sidecar plumbing. Contribute a VS
> Code Walkthrough (registered under `contributes.walkthroughs` in
> `package.json`) with seven steps that mirror the
> bootstrap-to-first-render flow described earlier in this plan; each
> step links to the relevant command or form. Implement
> `projectXml.initProject`, which collects `name`, `short_name`, and
> `author` via `window.showInputBox` and invokes the sidecar's
> `init_project` method (a wrapper around `render_doc.py --init`).
> The flow must work in an empty workspace.

### Phase 5 — Inline AI assistance
1.  Build `tools/ai/context.py` (grounding bundle assembler) and
    `tools/ai/pipeline.py` (validate → retry loop). Re-uses
    `lint_project.lint` and the XSD already in tree.
2.  Author per-intent prompt files in `tools/ai/intents/` and JSON
    Schemas in `tools/ai/schemas/`.
3.  Extend `project_io.py` with `ai_request(intent, context, target)`
    plus deterministic translators for each intent's response →
    JSON Patch.
4.  TypeScript side: `ai/participant.ts` registers the `@projectspec`
    chat participant via `vscode.chat.createChatParticipant`. Wire the
    `/draft-hlr`, `/expand`, `/review`, `/gap-fill` slash commands.
5.  Right-click "Draft / Expand / Review with AI" entries on tree
    nodes and code lenses. Quick Fix "Suggest correct ref with AI"
    on broken-trace diagnostics.
6.  Diff-preview-and-apply flow with backup + provenance log
    (`.edit_doc/ai_history.jsonl`).
7.  Settings UI for the `projectXml.ai.*` block; graceful disablement
    when no language model is available.
8.  Acceptance:
    *   `@projectspec /draft-hlr support reading from stdin` produces a
        schema-valid `<hlr>` with non-empty `<text>` and at least one
        plausible SDD trace; user accepts via diff and the entry
        appears in the tree, the rendered HLRs.md, and the lint passes.
    *   `/gap-fill --apply` walks every existing warning and proposes
        per-finding fixes that are validated before being offered.
    *   Disabling `projectXml.ai.enabled` removes every AI surface
        cleanly.

**AI prompt:**
> Build the inline AI layer described in §5.8. On the Python side,
> add `tools/ai/context.py` (assembles a grounding bundle from the
> PVD, SDD, upstream payloads, and XSD), `tools/ai/pipeline.py` (the
> validate→retry loop using `lint_project.lint` and the XSD), prompt
> files under `tools/ai/intents/`, and JSON Schemas under
> `tools/ai/schemas/`. Extend `project_io.py` with an `ai_request`
> method plus per-intent translators that turn AI responses into
> JSON Patches. On the TypeScript side, register a `@projectspec`
> chat participant via `vscode.chat.createChatParticipant` with the
> `/draft-hlr`, `/expand`, `/review`, and `/gap-fill` slash commands;
> add right-click "Draft / Expand / Review with AI" entries on tree
> nodes and Code Lenses; add a "Suggest correct ref with AI" quick
> fix on broken-trace diagnostics. Every applied edit must go through
> a diff-preview-and-apply flow that writes a backup and appends a
> provenance entry to `.edit_doc/ai_history.jsonl`. Honour the
> `projectXml.ai.*` settings, and hide every AI surface cleanly when
> `vscode.lm.selectChatModels` returns no models or
> `projectXml.ai.enabled` is `false`.

### Phase 5.5 — AI-assisted merge conflict resolution
1.  Implement `tools/project_merge.py`: a deterministic three-way
    structural merger over `Project.xml` (Stage A in §5.9.2). Pure
    Python, re-uses `render_doc.parse_project_to_dict` and the same
    write-back path used by the form webviews.
2.  Extend `project_io.py` with `merge_three_way(base, ours, theirs)`
    returning `{ merged_xml, residual_conflicts:[…], lint }`.
3.  Add the AI intents `merge.body`, `merge.trace`, `merge.rename`,
    `merge.schema_bump` under `tools/ai/intents/` and their JSON
    Schemas under `tools/ai/schemas/`. They re-use the validate→retry
    pipeline from Phase 5.
4.  TypeScript side: detect a conflicted `doc/Project.xml` via the
    `git` extension API, expose `projectXml.resolveMergeConflicts`,
    pull `:1`/`:2`/`:3` blobs via `git show`, drive the sidecar, and
    open the result in VS Code's three-way merge editor with
    AI-suggested regions badged.
5.  Add `@projectspec /resolve-conflicts` to the chat participant
    for a headless path that streams a per-region summary.
6.  Provenance: append one `.edit_doc/ai_history.jsonl` entry per
    AI-resolved region (intent, base/ours/theirs hashes, rationale,
    user accept/reject).
7.  Settings: `projectXml.merge.enabled` (default `true`),
    `projectXml.merge.aiResidualResolution` (default `true`,
    automatically forced to `false` when `projectXml.ai.enabled` is
    `false`).
8.  Acceptance:
    *   Two branches that each add a non-overlapping HLR to the same
        `<hlrs>/<section>` produce a clean merge with **no** AI
        involvement and pass lint.
    *   Two branches that edit the body of the same `<hlr>` produce
        a residual conflict that the AI layer resolves into a single
        merged body, presented in the merge editor with an ✨ badge;
        rejecting it falls back to the manual merge surface.
    *   With `projectXml.ai.enabled: false`, Stage A still runs and
        residual conflicts are left for manual resolution — no
        network calls, no AI surfaces.
    *   The post-merge `Project.xml` lints with no *new* errors
        compared to the union of pre-merge errors on either parent.

**AI prompt:**
> Implement the AI-assisted merge conflict resolver for
> `doc/Project.xml` described in §5.9. On the Python side, write
> `tools/project_merge.py` containing a deterministic three-way
> structural merger that operates on the parsed-dict representation
> from `render_doc.parse_project_to_dict`: union additions when ids
> do not collide, allocate the next free id only to *new*
> conflicting items (existing ids never move), union `<traces>` by
> `(target, ref)`, recompute `<metadata>/<counts>`, and preserve
> comments and formatting via the existing write-back path. Expose
> it through `project_io.py` as `merge_three_way(base, ours,
> theirs)` returning the merged XML, the list of residual
> conflicts, and a lint result. Add the four merge intents
> (`merge.body`, `merge.trace`, `merge.rename`, `merge.schema_bump`)
> under `tools/ai/intents/` with JSON Schemas under
> `tools/ai/schemas/`, all running through the Phase 5
> validate→retry pipeline so a candidate that fails XSD or lint is
> retried with the findings as feedback. On the TypeScript side,
> detect conflicted `doc/Project.xml` via the `git` extension API,
> add the `projectXml.resolveMergeConflicts` command, pull
> `:1:`/`:2:`/`:3:` via `git show`, and present the merged result
> in VS Code's three-way merge editor with each AI-resolved region
> badged "✨ AI suggestion". Add the `/resolve-conflicts` slash
> command to the `@projectspec` participant for a headless path.
> Append one entry per AI-resolved region to
> `.edit_doc/ai_history.jsonl`. Honour `projectXml.merge.enabled`
> and `projectXml.merge.aiResidualResolution`; the latter must be
> forced off when `projectXml.ai.enabled` is `false`. Never write
> automatically — the merge editor is the only commit surface.

### Phase 6 — Polish
1.  Settings UI, status bar item showing `n errors / m warnings`.
2.  Marketplace listing assets (icon, screenshots, animated GIF).
3.  CI to publish `.vsix` on tag.

**AI prompt:**
> Finish the extension for public release. Surface every
> `projectXml.*` setting through `contributes.configuration` with
> clear titles, descriptions, and sensible defaults. Add a status bar
> item that subscribes to lint results and displays `n errors / m
> warnings`, clickable to open the Problems panel filtered to
> `Project.xml`. Produce Marketplace assets under
> `tools/vscode-project-xml/media/`: a 128×128 icon, at least three
> screenshots covering the tree view, a form panel, and the
> render/preview flow, plus an animated GIF of the Walkthrough end to
> end. Add a GitHub Actions workflow that builds and publishes the
> `.vsix` on tag pushes matching `vscode-v*`, using `vsce package` and
> (optionally) `vsce publish` gated on a repository secret. Do not
> publish to the Marketplace from this prompt — only wire the CI.

## 9. Risks & Open Questions

*   **Python discovery.** Need a robust strategy to find Python on
    Windows/macOS/Linux: defer to the Microsoft Python extension's
    interpreter API if installed, otherwise fall back to
    `python3`/`python`.
*   **XML editing is text-based.** When the form panel writes via
    sidecar while the XML is open in a dirty text editor, we must
    handle the conflict (prompt user, refuse save, or merge). VS Code
    has APIs for this; needs explicit design.
*   **Webview ↔ extension messaging.** Standard pattern; bundle
    overhead can be significant. Reuse the same RJSF bundle as the
    web-form plan to avoid double work.
*   **Schema regeneration.** The extension caches a JSON Schema
    snapshot derived from `tools/project.xsd`; need a version check so
    users don't see stale fields after a schema bump.
*   **Marketplace publishing.** Optional. The `.vsix` install path is
    sufficient for in-team distribution.
*   **AI: model availability.** `vscode.lm.selectChatModels` may return
    no models (no Copilot, no compatible extension). All AI surfaces
    must hide themselves cleanly and the rest of the extension must
    remain fully functional.
*   **AI: hallucinated trace refs.** The validator-feedback retry loop
    catches most cases, but a model that *consistently* invents ids
    can burn the retry budget. Mitigation: the typed-response schema
    asks for refs from a closed set passed in the context, and the
    pipeline rejects unknown refs before validation.
*   **AI: prompt size vs. cost/latency.** The deterministic packer
    enforces `projectXml.ai.maxContextTokens`. For huge projects we
    summarise lists ("45 HLRs, ids HLR-001..HLR-045, sample 5 below")
    rather than enumerating everything.
*   **AI: provenance and audit.** `.edit_doc/ai_history.jsonl` is
    intentionally separate from Project.xml so the spec stays clean,
    but it is the only record of which content originated from a
    model. Decide whether to gitignore or commit it (recommend: commit
    in regulated environments, gitignore otherwise).
*   **Merge resolution: the "merge base" assumption.** Stage A in §5.9
    needs Git's three-way merge base (`:1:`/`:2:`/`:3:`) to distinguish
    "both sides added X" from "one side deleted, the other modified".
    Workspaces in unusual states (rebase-in-progress, octopus merges,
    cherry-picks without a base) need a fallback to two-way merge with
    every overlap routed through Stage B; the resolver must detect and
    refuse rather than silently pick one side.
*   **Merge resolution: AI on body merges is still prose merging.**
    The validator catches lint regressions but cannot judge whether
    the AI picked the *right* wording when both branches edited a
    requirement body. Mitigation: the merge editor is the only commit
    surface (no auto-apply path), and provenance is logged.
*   **AI: privacy.** Grounding bundles are sent to whatever model the
    user selected. The `contextAllowList` setting and trusted-workspace
    gating exist so users can't accidentally exfiltrate `.env` files
    or unrelated source code through this path.

## 10. Estimated Effort

Phases 0–5.5 are all required for the v1.0 baseline product
([PVD §5, §7.1](PVD.md)). Phase 6 is the public-release
polish layer.

| Phase | Scope | Skill mix | Rough size | Baseline? |
| ----- | ----- | --------- | ---------- | --------- |
| 0 | Sidecar foundations | Python | small | ✅ |
| 1 | Read-only extension | TypeScript + VS Code API | medium | ✅ |
| 2 | Code Lenses + Render | TypeScript | small-medium | ✅ |
| 3 | Form webview (HLR/LLR) | TS + React (webview) | medium | ✅ |
| 4 | SDD/STP/Test forms + Walkthrough | TS + Markdown content | medium | ✅ |
| 5 | Inline AI assistance | Python (prompts/schemas) + TS (chat API) | medium-large | ✅ |
| 5.5 | AI-assisted merge resolution | Python (3-way merger) + TS (merge editor) | medium | ✅ |
| 6 | Marketplace polish | Polish | small | release-only |

## 11. Out-of-Scope Follow-ups

*   **Codelens "Show in Traceability"** that opens
    `doc/Traceability.md` scrolled to the right anchor.
*   **CI integration.** A `Project Spec: Validate Pre-Push` task that
    fails the commit if `lint_project.py` reports errors. Already
    available via `make validate-xml`; the extension would just wire
    it to a Git hook.
*   **Bridge to the web form.** A command that boots the FastAPI
    server and opens it in the Simple Browser pane, for users who
    want the side-by-side preview without leaving VS Code.
