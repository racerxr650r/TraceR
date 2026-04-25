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
    TypeScript changes. Covered by **Phase 2.5** (delivered: the
    document-discovery / linter / badge / `<plan>` proof half),
    **Phase 2.5b** (the generic `ParsedNode` projection plus tree /
    lens / locator rewrite), and **Phase 2.5c** (the payload-
    agnostic Quick Fix table); inherited by Phases 3–4.
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
Phases 2.5 + 2.5b together; and the [PVD §6 #7](PVD.md) principle ("AI as a
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
1.  `CodeLensProvider` over `Project.xml`. The Phase-2 lens provider
    targets `<hlr>`, `<llr>`, and `<test>` with hard-coded selectors;
    Phase 2.5b replaces the selectors with the `ui_hints_index.lenses`
    walk so the same provider picks up any new payload kind.
2.  `projectXml.renderAndPreview` command that opens the rendered
    Markdown in a side-by-side preview pane backed by an in-memory
    virtual document (`tracer-preview:/<doc-id>.md`) — the preview
    surface **never writes a file** to disk, per [HLR-027](HLRs.md).
    Honours `projectXml.previewOnSave`.
3.  `projectXml.renderAll` command. Phase 2 enumerates a hard-coded
    list (`SDD|HLRs|LLRs|STP|Traceability`); Phase 2.5 swapped that
    for a `list_documents` call so new templates are picked up
    automatically (delivered).
4.  Acceptance: clicking a Code Lens link jumps to the correct LLR;
    saving the file (with `previewOnSave: true`) updates the preview
    without producing any new files under `doc/`.

**AI prompt:**
> Add a `CodeLensProvider` to the extension that decorates every
> `<hlr>`, `<llr>`, and `<test>` element in `Project.xml` with
> coverage status (e.g. "3 LLRs · 5 tests") plus click-through
> commands that jump to each related element. Add a
> `projectXml.renderAndPreview` command that calls the sidecar's
> `render` method for the affected document and opens the result in a
> side-by-side Markdown preview backed by an in-memory virtual
> document (`tracer-preview:/<doc-id>.md`) served by a
> `TextDocumentContentProvider` — the preview must never write a file
> under `doc/`. Add a `projectXml.renderAll` command that regenerates
> every spec under `doc/` using the hard-coded baseline document list
> (`SDD|HLRs|LLRs|STP|Traceability`); the list will be replaced by a
> `list_documents` sidecar call in Phase 2.5 (delivered), so keep
> the document set in a single named constant that Phase 2.5 can
> swap. Honour the
> `projectXml.previewOnSave` setting. Keep all rendering in the
> sidecar — do not reimplement template logic in TypeScript.

### Phase 2.5 — Schema-driven retrofit (delivered)

**Why this phase exists.** Phases 1 and 2 ship hard-coded surfaces
(tree nodes for HLRs/LLRs/Tests/SDD/STP, code lenses keyed on those
five element names, render commands enumerating a fixed list of
document ids). The PVD update of 2026-04 introduced [Principle 11
"Schema-driven surfaces"](PVD.md) and the
["Schema-driven extensibility" success metric](PVD.md), which
require that adding a new generated document, a new payload
section, or a new field be a schema-and-template change — not a
TypeScript change. This phase begins that retrofit before Phase 3's
form panels lock in any further hard-coded payload assumptions.

The retrofit splits into three sub-phases. **Phase 2.5** (this
section) ships the schema-driven document discovery surface and the
acceptance proof that proves the contract works end-to-end.
**Phase 2.5b** (below) takes on the bigger surgery — a generic
`ParsedNode` projection plus tree / lens / locator / form rewrites
driven by the `ui_hints_index`. **Phase 2.5c** (below) lands the
payload-agnostic Quick Fix table.

The split exists because the work in 2.5b is large enough to
benefit from being driven by a concrete second consumer. With
`<plan>` shipping in the test fixture as that second consumer (and
with the badge / discovery infrastructure proving the linter →
extension contract), 2.5b can be executed against a real second
payload rather than against the abstract idea of "any future
payload".

1.  **Schema-driven document discovery.** `tools/project_io.py`
    grows a `list_documents` JSON-RPC method that enumerates
    `<metadata><document>` entries (id / title / source / version /
    date / author / template / output) — convention falls back to
    `tools/templates/<id>.md.j2` and `<source>` when `template=`
    and `output=` are absent on the `<document>`. The XSD accepts
    the optional `template=` / `output=` attributes on
    `Document` (schema_version 1.2). The five canonical entries in
    `doc/Project.xml` carry both attributes explicitly so the
    schema is self-describing without relying on the convention.
    Both the extension's `projectXml.renderAndPreview`, its
    `projectXml.renderAll`, and a runtime-registered family of
    `projectXml.render.<id>` commands enumerate that surface
    instead of a hard-coded list of `SDD|HLRs|LLRs|STP|Traceability`.
    The Markdown preview reads the same surface. Pinned by
    HLR-054 / HLR-055 / HLR-056 / LLR-MET-01..05 in
    [Project.xml](Project.xml).
2.  **Linter alignment.** `tools/lint_project.py`'s `STANDARD_DOCS`
    set is replaced by the document-id set returned by
    `list_documents` against the project being linted; the
    "required document missing" check becomes "any
    `<metadata><document>` whose `template=` (explicit attr or
    convention) is missing from disk emits `missing-template`".
    The hard-coded five-doc set is gone. The `Finding` record
    grows an optional `code` field
    (`broken-trace` / `id-format` / `missing-template` / `no-test`)
    so downstream surfaces can dispatch on a stable token rather
    than the message text; the legacy `errors` / `warnings` /
    `notes` lists in `Findings.to_dict()` remain byte-identical
    for cross-surface equivalence (HLR-043).
3.  **Reserved `ui:*` namespace + `ui:icon` / `ui:color` / `ui:group`
    on payload elements.** `tools/project.xsd` declares
    `xmlns:ui="urn:tracer:ui:v1"` and accepts arbitrary `ui:*`
    attributes via `<xs:anyAttribute namespace="urn:tracer:ui:v1"
    processContents="skip"/>` on `<hlr>`, `<llr>`, `<test>`, and
    `<module>`. The Python renderer projects the recognised key
    subset (`icon`, `color`, `group`) onto a `ui` field on every
    parsed payload (returns `None` when no recognised hint is
    present). The VS Code tree provider's leaf builders consume
    that field via a small `applyHintsToNode(node, hints)` helper
    that sets `node.iconPath = ThemeIcon(icon, ThemeColor(color))`.
    `ui:group` is reserved-and-ignored today. Pinned by HLR-058 /
    LLR-HNT-01..04. **The full `xs:appinfo` vocabulary
    (`ui:treeNode`, `ui:form`, `ui:lens`, `ui:document`) is
    deferred to Phase 2.5b** — Phase 2.5 only reserves the
    namespace and ships the per-element decoration channel.
    Schema_Reference.md §14 documents `<plan>` as the example
    payload; §15 pins the `Finding` / `LintFinding` / `code`
    contract.
4.  **Coverage status badges.** Every HLR / LLR leaf in the Project
    Spec tree is decorated with ❌ when any error finding cites it
    and ⚠ when only warnings do, derived from `Findings.items`
    keyed by `Finding.code`. The badge index lives in
    `util/badges.ts`; the tree provider's `setBadges()` is fed by
    the same diagnostics run that populates the Problems panel, so
    a single source — the linter — drives both surfaces. Gated on
    the `projectXml.showCoverageBadges` setting. Pinned by HLR-057
    / LLR-BDG-01..04.
5.  **Activation cleanup.** `package.json`'s `activationEvents`
    collapses to a single `workspaceContains:doc/Project.xml`; the
    redundant `onCommand:projectXml.renderAndPreview` and
    `onCommand:projectXml.renderAll` entries are removed. The
    runtime-registered `projectXml.render.<id>` family
    deliberately rides the same trigger so the static / dynamic
    halves of the manifest stay symmetrical.
6.  **`<plan>` acceptance proof.** A synthetic `<plan>` payload, a
    `tools/templates/Plan.md.j2` template, and a
    `<metadata><document id="Plan">` entry are added to
    `test/doc/Project.xml`. With **zero** TypeScript changes, the
    extension shows a `Plan` document under the dynamic render
    commands, opens the rendered `Plan.md` in the side preview,
    lints cleanly, and renders byte-identically across the CLI,
    the in-process library, and the JSON-RPC sidecar. This is the
    canonical regression test for the schema-driven contract; if a
    future contributor adds a hard-coded reference to one of the
    five "standard" payloads, the `<plan>` proof fails first.

**Not in Phase 2.5 (carried into 2.5b / 2.5c):**

*   The generic `ParsedNode` projection and `ui_hints_index`
    surface — sidecar still emits the hand-typed
    `ParsedSdd` / `ParsedHlr` / `ParsedLlr` / `ParsedTest`
    interfaces, augmented only with the optional `ui` field.
*   The generic tree / lens / locator rewrite — five
    `build*Node` builders and the HLR / LLR / test / module
    selectors are still hard-coded; the schema-driven payoff for
    *new* tree nodes / lenses / reveal-in-XML targets is the work
    of 2.5b.
*   The full `xs:appinfo` UI-hint vocabulary (`ui:treeNode`,
    `ui:form`, `ui:lens`, `ui:document`) — only the per-element
    `ui:icon` / `ui:color` / `ui:group` decoration channel is in.
*   The payload-agnostic `CodeActionProvider` Quick Fix table
    keyed on `Finding.code` — covered by Phase 2.5c.

### Phase 2.5b — Generic schema-driven projection

The bigger surgery. Phase 2.5 proved the linter and document-
discovery sides of the schema-driven contract; 2.5b pushes the
contract through the rest of the extension surfaces so adding a
new `<payload>` to the XSD (with `ui:treeNode` / `ui:lens` /
`ui:form` annotations) wires up the Project Spec tree, code
lenses, locator, and Phase 3 form panels with no TypeScript edits.

1.  **Full `xs:appinfo` UI-hint vocabulary.** Extend
    `tools/project.xsd` with `<xs:appinfo>` annotations under the
    existing `urn:tracer:ui:v1` namespace covering at minimum:
    *   `ui:treeNode label="@name|@id" idAttr="id" group="..."` —
        element appears in the Project Spec tree.
    *   `ui:form field="text|textarea|enum|ref:HLR|ref:LLR|cdata"`
        on each editable attribute / child element.
    *   `ui:lens kind="coverage|tracesCount|custom:<name>"` —
        which code lens to attach.
    *   `ui:document id="..."` on `<metadata><document>` to mark
        which ids are renderable targets (today inferred from the
        presence of the `<document>` row itself).
    Document the vocabulary in
    [Schema_Reference.md](Schema_Reference.md) alongside §14
    (`<plan>` payload) and §15 (linter contract) shipped in 2.5.
    Bump `<project schema_version>` (1.3 → 1.4).
2.  **Generic JSON projection.** Replace the hand-typed
    `ParsedSdd` / `ParsedHlr` / `ParsedLlr` / `ParsedTest` /
    `ParsedSddModule` interfaces in
    `tools/vscode-project-xml/src/sidecar.ts` with a generic
    `ParsedNode { tag, attrs, text?, children: Record<string,
    ParsedNode[]> }`. Extend `tools/project_io.py`'s
    `parse_to_json` to emit this shape plus an inline
    `ui_hints_index` derived from the XSD `<xs:appinfo>` blocks so
    the TypeScript side never re-parses the schema. The
    `Finding.code` table from 2.5 stays exactly as it is.
3.  **Generic tree provider.** Rewrite
    `src/treeView/ProjectSpecProvider.ts` to walk
    `ui_hints_index.treeNodes` instead of calling `buildHlrsNode` /
    `buildLlrsNode` / `buildSddNode` / `buildStpNode` /
    `buildTestsNode`. The five hard-coded builders are deleted; the
    same view rebuilds itself when the schema declares a new
    top-level node. The `applyHintsToNode()` decoration path
    shipped in 2.5 stays as the seam for icon / color / group
    application; the badge index from 2.5 stays as the seam for
    `Finding.code`-driven status decoration.
4.  **Generic locator.** Rewrite `src/util/locator.ts` so it takes
    `(elementName, idAttr, idValue)` from the hint registry rather
    than special-casing HLR / LLR / test / module element names.
    Reveal-in-XML for new tree nodes works without locator edits.
5.  **Generic code lenses.** Replace the Phase 2 lens provider's
    fixed `<hlr>` / `<llr>` / `<test>` selectors with one driven by
    `ui_hints_index.lenses`; the existing coverage and
    traces-count computations move into named lens kinds that any
    new payload can opt into via `ui:lens`.
6.  **Acceptance.** Add a new top-level payload to the test
    fixture `Project.xml` whose XSD type carries `ui:treeNode`,
    `ui:lens kind="coverage"`, and per-attribute `ui:form` hints,
    and a corresponding template under `tools/templates/`. With
    **zero** TypeScript edits, the extension must show the new
    payload's tree node, attach the coverage lens, reveal-in-XML
    correctly, and (when Phase 3 lands) drive a form panel from
    the same hints. The `<plan>` regression case shipped in 2.5
    must continue to pass.
7.  **Carry-forward contract for Phases 3–6.** From the moment
    2.5b lands, every new surface (form panels, walkthrough steps,
    AI tree context-menu commands per [HLR-053](HLRs.md), AI
    intents, merge intents, status bar) consults the hint registry
    rather than naming payload elements directly. Bespoke widgets
    and domain-specific lint rules remain the only payload-aware
    code paths, as required by [PVD §6 #11](PVD.md).

**AI prompt:**
> Complete the schema-driven retrofit started in Phase 2.5: extend
> `tools/project.xsd` with the full `<xs:appinfo>` UI-hint
> vocabulary (`ui:treeNode`, `ui:form`, `ui:lens`, `ui:document`)
> under the existing `urn:tracer:ui:v1` namespace, document it in
> `Schema_Reference.md`, and bump `schema_version` to 1.4. Extend
> `tools/project_io.py`'s `parse_to_json` to emit a generic
> `ParsedNode` tree plus a `ui_hints_index` distilled from the
> XSD. On the TypeScript side, replace the hand-typed
> `ParsedSdd` / `ParsedHlr` / `ParsedLlr` / `ParsedTest` /
> `ParsedSddModule` interfaces in `sidecar.ts` with one generic
> `ParsedNode`; rewrite `ProjectSpecProvider`, the lens provider,
> and `util/locator.ts` to walk the hint registry instead of
> calling per-payload builders. Keep the per-element
> `applyHintsToNode()` decoration path and the `Finding.code`
> badge index from Phase 2.5 in place — both stay as seams. Prove
> the retrofit by adding a second synthetic payload (one beyond
> `<plan>`) whose XSD type carries `ui:treeNode`,
> `ui:lens kind="coverage"`, and per-attribute `ui:form` hints,
> and showing that the extension picks up the new tree node, the
> coverage lens, and (in Phase 3) a form panel with **zero**
> TypeScript edits. The existing `<plan>` regression case must
> continue to pass.

### Phase 2.5c — Payload-agnostic Quick Fix table

A standalone surface that does not depend on 2.5b's generic
projection — it keys on `Finding.code` (already shipped in 2.5)
and uses VS Code `WorkspaceEdit` text edits, so it does not need
the Phase 3 `apply_edit` write path.

1.  Implement a `CodeActionProvider` whose Quick Fix table is
    keyed on `Finding.code` rather than payload element name (per
    [HLR-012](HLRs.md), [HLR-025](HLRs.md), SDD §13):
    *   `broken-trace` — "Replace ref with…" picker populated from
        the parsed tree (HLRs / LLRs / module paths in scope).
    *   `id-format` — "Renumber as next free `HLR-NNN` /
        `LLR-XXX-NN`".
    *   `missing-template` — "Insert standard `<document>` row" or
        "Stub the missing template file".
    *   `no-test` — "Create stub `<test>` entry".
2.  All Phase 2.5c fixes use `WorkspaceEdit` text edits; structural
    rewrites that need an XSD-validated round-trip route through
    `apply_edit` once Phase 3 lands. AI-suggest Quick Fix variants
    remain Phase 5.
3.  Acceptance: triggering each `Finding.code` value on the
    `<plan>` fixture surfaces the correct Quick Fix without any
    payload-specific code path; applying the fix produces a clean
    re-lint.

**AI prompt:**
> Implement a payload-agnostic `CodeActionProvider` for the
> `Project.xml` `tools/vscode-project-xml/` extension whose
> Quick Fix table is keyed on the `Finding.code` values shipped
> in Phase 2.5 (`broken-trace`, `id-format`, `missing-template`,
> `no-test`) — never on payload element name. All fixes use VS
> Code `WorkspaceEdit` text edits so the Phase 3 `apply_edit`
> write path is not yet required. Prove correctness by triggering
> each finding code on the `<plan>` fixture and showing that the
> Quick Fix appears, applies, and produces a clean re-lint
> without any `<plan>`-specific code path.

### Phase 3 — Form webview for HLRs and LLRs
1.  Single-item form panel with RJSF whose JSON Schema is derived at
    runtime from the relevant XSD subtree plus the `ui:form` field
    hints from the Phase 2.5b hint registry (per [HLR-026](HLRs.md));
    no per-payload form code.
2.  `apply_edit(json_patch)` sidecar method (per [HLR-019](HLRs.md))
    that applies each JSON Patch on a working copy, runs XSD + lint,
    and **only on a clean result** persists back to `Project.xml`.
    Writes go through `lxml` so comments, CDATA, attribute order,
    and whitespace are preserved (per [HLR-018](HLRs.md)).
3.  Add-new commands for HLR and LLR; new IDs always allocate the
    next free number (per [HLR-005](HLRs.md)).
4.  Dirty-buffer collision: if `doc/Project.xml` is open with
    unsaved changes when a form submits, prompt the user to save or
    discard before applying the patch.
5.  Extend the Phase 2.5c Quick Fix table so any fix that needs a
    structural rewrite (rather than a flat text replacement) routes
    through the new `apply_edit` path; the existing `WorkspaceEdit`
    fixes continue to work unchanged. AI-suggest Quick Fix variants
    remain Phase 5.
6.  Acceptance: add a new HLR via the form, see it appear in the
    XML with formatting and comments preserved, in the tree, and in
    the rendered HLRs.md preview; an `apply_edit` that fails XSD or
    lint must leave `doc/Project.xml` byte-identical to its
    pre-call state and return the findings to the caller.

**AI prompt:**
> Implement the first interactive surface: a Webview-based form
> panel that edits a single `<hlr>` or `<llr>` using
> [react-jsonschema-form](https://rjsf-team.github.io/react-jsonschema-form/)
> driven by a JSON Schema derived at runtime from the relevant XSD
> subtree plus the `ui:form` field hints in the Phase 2.5b
> `ui_hints_index` — do not write per-payload form code. Add an
> `apply_edit(json_patch, expect_clean=true)` method to
> `tools/project_io.py` that applies each JSON Patch on a working
> copy of the parsed tree, runs XSD + `lint_project.lint`, and
> **only on a clean result** writes the merged tree back to
> `doc/Project.xml` via `lxml` so comments, CDATA, attribute
> order, and whitespace are preserved (HLR-018, HLR-019). On
> validation failure the on-disk file must be byte-identical to
> its pre-call state and the findings returned to the caller. The
> form sends a JSON Patch through the sidecar; the extension
> handles the dirty-buffer case by prompting the user before
> applying. Add `projectXml.addHlr` and `projectXml.addLlr`
> commands that open a blank form and allocate the next free
> `HLR-NNN` / `LLR-XXX-NN` (HLR-005). Extend the Phase 2.5c Quick
> Fix table so that fixes needing a structural rewrite route
> through `apply_edit` while flat text rewrites stay on
> `WorkspaceEdit`; AI-suggest Quick Fix variants stay Phase 5.

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
1.  Build `tools/ai/context.py` (grounding bundle assembler, per
    [HLR-029](HLRs.md)) and `tools/ai/pipeline.py` (validate → retry
    loop, per [HLR-030](HLRs.md)–[HLR-031](HLRs.md)). Re-uses
    `lint_project.lint` and the XSD already in tree.
2.  Author per-intent prompt files in `tools/ai/intents/` and JSON
    Schemas in `tools/ai/schemas/` covering **every** payload kind
    in the SDD → HLR → LLR → Test stack plus the hand-authored PVD
    (per [HLR-048](HLRs.md), [HLR-049](HLRs.md),
    [HLR-050](HLRs.md), [HLR-051](HLRs.md), [HLR-052](HLRs.md)):

    | Intent | Purpose | HLR |
    | ------ | ------- | --- |
    | `draft.module` | Draft a new SDD module/component from a natural-language target. | HLR-048 |
    | `draft.hlr` | Draft a new HLR with at least one plausible SDD trace. | HLR-048 |
    | `draft.llr` | Draft a new LLR with HLR traces pre-populated. | HLR-048 |
    | `draft.test` | Draft a new `<test>` purpose with LLR/HLR traces pre-populated. | HLR-048 |
    | `draft.pvd` | Ghostwrite a section of `doc/PVD.md` (see below). | HLR-052 |
    | `expand.hlr_to_llrs` | Draft a candidate set of LLRs for a selected HLR. | HLR-049 |
    | `expand.llr_to_tests` | Draft test purposes for a selected LLR. | HLR-049 |
    | `review.item` | Advisory review of an HLR/LLR/test/SDD module against its upstream item. | HLR-050 |
    | `suggest.traces` | Propose plausible upstream `<trace>` targets for any payload element. | HLR-051 |
    | `gap.fix` | Draft the missing LLR or test that would close a coverage-gap warning. | HLR-051 |

    Every authoring intent (apart from `draft.pvd`, whose target is
    Markdown) returns a **typed JSON object validated against its
    intent schema** (per [HLR-030](HLRs.md)) — raw XML responses are
    rejected; pre-fills use stable IDs allocated from the parsed
    tree (per [HLR-051](HLRs.md), [HLR-005](HLRs.md)).
3.  **PVD ghostwriting flow** (per [HLR-052](HLRs.md), SDD §10.1).
    `draft.pvd` differs from the other intents in that the target is
    `doc/PVD.md`, not a `Project.xml` payload. The intent shall:
    *   Identify thin/missing PVD sections by structure
        (placeholders, single-sentence sections expected to be
        paragraphs, single-item lists where multiple are expected).
    *   Surface targeted clarifying questions to the user before
        drafting any prose; never invent vision, scope, success
        metrics, or roadmap themes.
    *   Draft prose matching the existing voice, heading depth, and
        table style of the document.
    *   Route every accepted PVD edit through the same diff-preview
        gate ([HLR-032](HLRs.md)) and provenance log
        ([HLR-033](HLRs.md)) as Project.xml edits.
4.  Extend `project_io.py` with `ai_request(intent, context, target)`
    plus deterministic translators for each authoring intent's
    response → JSON Patch (re-using the Phase 3 `apply_edit` write
    path for `Project.xml` edits and a separate diff applier for
    PVD edits).
5.  TypeScript side: `ai/participant.ts` registers the
    `@projectspec` chat participant via
    `vscode.chat.createChatParticipant`. Slash commands cover the
    full intent matrix: `/draft-hlr`, `/draft-llr`, `/draft-test`,
    `/draft-module`, `/draft-pvd`, `/expand`, `/review`,
    `/suggest-traces`, `/gap-fill`.
6.  **Schema-driven AI tree menu** (per [HLR-053](HLRs.md), carry-
    forward contract from Phase 2.5b). Right-click context-menu
    entries on every Project Spec tree node — `Draft …`,
    `Expand …`, `Review with AI`, `Suggest traces with AI`,
    `Fix gap with AI` — are derived from the `ui_hints_index`
    (a per-element-kind `aiActions` projection), **not** hard-coded
    per element name. A new payload kind that adds a `ui:treeNode`
    hint inherits the applicable AI surface for free.
7.  AI-suggest Quick Fix variants on the Phase 2.5c Quick Fix table
    (e.g. "AI: suggest correct ref" on `broken-trace`).
8.  Diff-preview-and-apply flow with backup + provenance log
    (`.edit_doc/ai_history.jsonl`) per [HLR-032](HLRs.md) and
    [HLR-033](HLRs.md). `projectXml.ai.autoApplyValidated`
    defaults to `false` and is honoured even for fully-validated
    suggestions.
9.  Settings UI for the `projectXml.ai.*` block.
10. **Graceful degradation and trust gating** (per
    [HLR-044](HLRs.md), [HLR-045](HLRs.md)):
    *   When `vscode.lm.selectChatModels()` returns no models, the
        chat participant is unregistered, the AI tree context-menu
        entries and slash commands are hidden, the AI-suggest
        Quick Fix variants are suppressed, and every deterministic
        surface (tree, diagnostics, code lenses, form panels,
        render, Stage A merge from Phase 5.5) continues to
        function unchanged.
    *   In an untrusted workspace
        (`untrustedWorkspaces.supported = "limited"`), AI activation
        is blocked entirely with a one-shot warning notification;
        deterministic surfaces remain available.
    *   Disabling `projectXml.ai.enabled` removes every AI surface
        cleanly without unloading the extension.
11. Acceptance:
    *   `@projectspec /draft-hlr support reading from stdin` produces
        a schema-valid `<hlr>` with non-empty `<text>` and at least
        one plausible SDD trace; user accepts via diff and the entry
        appears in the tree, the rendered HLRs.md, and the lint
        passes.
    *   `/expand` on a selected HLR produces a candidate set of LLRs
        with HLR traces pre-populated; each candidate passes XSD +
        lint before being shown.
    *   `/draft-pvd` on a thin PVD section first asks at least one
        targeted clarifying question; only after the user answers
        does the AI draft prose, and the result is shown in a diff
        before any write.
    *   `/gap-fill --apply` walks every existing coverage warning
        and proposes per-finding fixes (LLR or test) that are
        validated before being offered.
    *   `/review` on any HLR/LLR/test/module returns advisory
        findings without ever producing a JSON Patch.
    *   With no language model selectable, every AI surface is
        invisible and Phase 1–3 functionality is unaffected.
    *   In an untrusted workspace, no AI surface activates and the
        deterministic surfaces still work.
    *   Disabling `projectXml.ai.enabled` removes every AI surface
        cleanly.

**AI prompt:**
> Build the inline AI layer described in §5.8 and HLR-029–033,
> HLR-044–045, and HLR-048–053. On the Python side, add
> `tools/ai/context.py` (assembles a grounding bundle from the
> PVD, SDD, upstream payloads, and XSD; deterministic packer that
> never drops the schema or user intent), `tools/ai/pipeline.py`
> (the
> validate→retry loop using `lint_project.lint` and the XSD), prompt
> files under `tools/ai/intents/`, and JSON Schemas under
> `tools/ai/schemas/` covering the full authoring matrix:
> `draft.module`, `draft.hlr`, `draft.llr`, `draft.test`,
> `draft.pvd`, `expand.hlr_to_llrs`, `expand.llr_to_tests`,
> `review.item`, `suggest.traces`, `gap.fix`. Every intent except
> `draft.pvd` returns a typed JSON object that the deterministic
> per-intent translator turns into a JSON Patch routed through the
> Phase 3 `apply_edit` path; `draft.pvd` produces a Markdown diff
> instead. The `draft.pvd` flow shall identify thin/missing PVD
> sections by structure, surface targeted clarifying questions
> before drafting prose, never invent vision/scope/metrics/roadmap,
> and route accepted edits through the same diff-preview gate and
> provenance log as Project.xml edits (HLR-052). Extend
> `project_io.py` with an `ai_request` method plus per-intent
> translators. On the TypeScript side, register a `@projectspec`
> chat participant via `vscode.chat.createChatParticipant` with the
> slash commands `/draft-hlr`, `/draft-llr`, `/draft-test`,
> `/draft-module`, `/draft-pvd`, `/expand`, `/review`,
> `/suggest-traces`, `/gap-fill`. Add right-click
> "Draft / Expand / Review / Suggest traces / Fix gap with AI"
> entries on every Project Spec tree node, with the per-node
> command set derived from the `ui_hints_index` `aiActions`
> projection — **not** hard-coded per element kind (HLR-053);
> a new payload kind with a `ui:treeNode` hint must inherit the
> applicable AI surface for free. Add a "Suggest correct ref with
> AI" Quick Fix variant on `broken-trace` diagnostics. Every
> applied edit must go through a diff-preview-and-apply flow that
> writes a backup and appends a provenance entry to
> `.edit_doc/ai_history.jsonl`. Honour the `projectXml.ai.*`
> settings, and enforce graceful degradation per HLR-044/HLR-045:
> when `vscode.lm.selectChatModels` returns no models, when the
> workspace is untrusted, or when `projectXml.ai.enabled` is
> `false`, hide every AI surface cleanly while keeping every
> deterministic surface (tree, diagnostics, lenses, form panels,
> render, Stage A merge) fully functional.

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
    *   When the Git merge base is unavailable
        (rebase-in-progress, octopus merge, cherry-pick without a
        base), Stage A **refuses** with an explicit notification
        rather than silently picking one side or falling through to
        Stage B (per [HLR-034](HLRs.md), SDD §9.1, and the
        graceful-degradation design goal).

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
1.  Settings UI surfacing every `projectXml.*` setting through
    `contributes.configuration` (the authoritative list lives in
    SDD §21 “Compile-time constants”).
2.  Status bar item showing `n errors / m warnings`, clickable to
    open the Problems panel filtered to `Project.xml`. The item
    displays warnings verbatim and never downgrades them —
    `projectXml.warningsAsErrors` only escalates severity, it never
    suppresses (per [HLR-042](HLRs.md)).
3.  Marketplace listing assets (icon, screenshots, animated GIF).
4.  CI to publish `.vsix` on tag.

**AI prompt:**
> Finish the extension for public release. Surface every
> `projectXml.*` setting through `contributes.configuration` with
> clear titles, descriptions, and the defaults documented in SDD
> §21 “Compile-time constants”. Add a status bar item that
> subscribes to lint results and displays `n errors / m
> warnings`, clickable to open the Problems panel filtered to
> `Project.xml`; warnings must be displayed verbatim and never
> hidden, per [HLR-042](HLRs.md) — `projectXml.warningsAsErrors`
> may escalate severity but must not suppress. Produce Marketplace
> assets under `tools/vscode-project-xml/media/`: a 128×128 icon,
> at least three screenshots covering the tree view, a form panel,
> and the render/preview flow, plus an animated GIF of the
> Walkthrough end to end. Add a GitHub Actions workflow that
> builds and publishes the `.vsix` on tag pushes matching
> `vscode-v*`, using `vsce package` and (optionally) `vsce
> publish` gated on a repository secret. Do not publish to the
> Marketplace from this prompt — only wire the CI.

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
