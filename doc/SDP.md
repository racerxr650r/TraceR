# Software Development Plan Document (SDP): VS Code Extension for Project.xml Authoring

**Status:** Baseline product (per [PVD §5, §7.1](PVD.md))

## Status

| Phase | Description | Status |
| ----- | ----------- | ------ |
| [0](#phase-0--sidecar-foundations) | Sidecar foundations: importable `render_doc.py` / `lint_project.py`, JSON-RPC `tools/project_io.py`, test suite. | ✅ Complete |
| [1](#phase-1--read-only-extension) | Read-only VS Code extension: tree view, lint diagnostics, Reveal in XML. | ✅ Complete |
| [2](#phase-2--code-lenses--render) | Code Lenses + Render & Preview. | ✅ Complete |
| [2.5](#phase-25--schema-driven-retrofit-delivered) | Schema-driven retrofit: `list_documents` discovery, dynamic `Render <Doc>` commands, `Finding.code` linter contract, `ui:*` per-element hints, coverage status badges, `<plan>` acceptance proof. | ✅ Complete |
| [2.5b](#phase-25b--generic-schema-driven-projection) | Generic schema-driven projection: full `xs:appinfo` vocabulary, generic `ParsedNode`, tree / lens / locator rewrite. | ✅ Done — Python `_ui_hints_index` + `_nodes` over JSON-RPC; TS shim typed; tree provider auto-projects any `<ui:treeNode/>` payload, lens provider scans schema-declared lens kinds, lint diagnostics resolve schema-declared id tokens. Adding a new payload requires zero TypeScript edits. |
| [2.5c](#phase-25c--payload-agnostic-quick-fix-table) | Payload-agnostic Quick Fix table keyed on `Finding.code`. | ✅ Done — `CodeActionProvider` dispatches on `Finding.code` (`broken-trace`, `id-format`, `missing-template`, `no-test`); every fix uses `WorkspaceEdit` text edits, none reference payload element name. |
| [3](#phase-3--form-webview-for-hlrs-and-llrs) | Form webviews for HLRs / LLRs. | ✅ Done — `tools/project_edit.py` adds `apply_edit` (lxml round-trip + validate-then-write, byte-identical on failure) and a payload-agnostic XSD→JSON-Schema deriver; sidecar exposes `apply_edit` / `form_schema` / `next_free_id`; React + RJSF webview drives `Project Spec: Add HLR` / `Add LLR` / edit-payload; the structural `no-test` Quick Fix routes through `apply_edit`. |
| [4](#phase-4--sddstptest-forms--walkthrough) | SDD/STP/Test forms + Walkthrough. | ✅ Done — `FormPanelProvider` widened to any complex type carrying a `<ui:form>` annotation; `<ui:form>` added to `StpFixture` and `TestFile`; new commands `Project Spec: Add SDD Module / Add STP Fixture / Add Test File / Add Test`; `Project Spec: Initialise Project.xml…` bootstraps a brand-new project from an empty workspace via the sidecar's `init_project`; seven-step **Get Started with Project Spec** Walkthrough makes the bootstrap-to-first-render flow discoverable from VS Code's Get Started page. Schema bumped to `1.5`. |
| [5a](#phase-5a--python-grounding--pipeline) | Inline AI assistance — Python grounding & pipeline. | ✅ Done — `tools/ai/{registry,context,pipeline,translators,provenance}.py` with 10 registered intents (`draft.{module,hlr,llr,test,pvd}`, `expand.hlr_to_llrs`, `expand.llr_to_tests`, `review.item`, `suggest.traces`, `gap.fix`); per-intent system prompts under `tools/ai/intents/` and Draft-07 JSON Schemas under `tools/ai/schemas/`; sidecar `ai_request` JSON-RPC method (stateless `prepare`/`evaluate`/`run` so the TS layer owns `vscode.lm.*` per HLR-045); deterministic translators emit `apply_edit`-shaped JSON Patches; PVD ghostwriting prompt with clarifying-question rules (HLR-052); provenance JSONL at `<workspace>/.edit_doc/ai_history.jsonl` (HLR-049); `apply_edit` gains `dry_run` for diff-preview; `parse_ui_hints_index` projects `ai_actions` per `<ui:treeNode/>` payload (HLR-053). New JSON-RPC error code `-32020 NO_LANGUAGE_MODEL`. 123 unittests green. |
| [5b](#phase-5b--typescript-surfaces) | Inline AI assistance — TypeScript surfaces. | ✅ Done — `@projectspec` chat participant (`vscode.chat.createChatParticipant`) with slash commands `/draft-hlr`, `/draft-llr`, `/draft-test`, `/draft-module`, `/draft-pvd`, `/expand`, `/review`, `/suggest-traces`, `/gap-fill`; schema-driven AI tree context-menu entries projected from `ui_hints_index.ai_actions`; AI Quick Fix variant on `broken-trace`; diff-preview-and-apply with timestamped backup under `.edit_doc/backups/`; settings UI for `projectXml.ai.{enabled,modelFamily,maxTokens,autoApplyValidated,historyLog}`; graceful degradation per HLR-044/045 — when `vscode.lm.selectChatModels` returns no models, the workspace is untrusted, or `projectXml.ai.enabled` is false, every AI surface is hidden cleanly while every deterministic surface (tree, diagnostics, lenses, form panels, render, Stage A merge) remains fully functional. |
| [5.5](#phase-55--ai-assisted-merge-conflict-resolution) | AI-assisted merge conflict resolution. | ✅ Done — `tools/project_merge.py` deterministic Stage A three-way merger (lxml-based, preserves comments / CDATA / attribute order; unions disjoint adds and `<traces>` rows; reallocates colliding ids; recomputes `<metadata>/<counts>`; refuses cleanly when the Git merge base is unavailable per HLR-034); sidecar JSON-RPC methods `merge_three_way` and `apply_merge_resolution`; four `merge.*` AI intents (`merge.body`, `merge.trace`, `merge.rename`, `merge.schema_bump`) with `kind="merge"` skipping the `apply_edit` path; `projectXml.resolveMergeConflicts` command + `MergeConflictResolver` (Git extension API to detect MERGE state, three-way blob fetch via `git show :1/:2/:3`, per-region "✨ AI suggestion" badging, accept/reject in the merge editor — never writes automatically per SDP §5.9); `@projectspec /resolve-conflicts` slash command; per-region provenance to `.edit_doc/ai_history.jsonl` (sha-1 of base/ours/theirs + intent + rationale); settings `projectXml.merge.{enabled,aiResidualResolution}` (the latter forced off when `projectXml.ai.enabled=false`). |
| [6](#phase-6--polish) | Marketplace polish. | ✅ Done — extension `prepackage` script bundles `tools/{project_io,render_doc,lint_project,project_edit,project_merge}.py`, `project.xsd`, `templates/`, and `ai/` into `tools/vscode-project-xml/dist/python/` and writes the source XSD's `version` attribute into `dist/python/.bundle_version`; `.vscodeignore` retains the bundled tree so the shipped `.vsix` is fully self-contained (HLR-060). `getToolsDir()` falls back to `<extensionPath>/dist/python` when the workspace has no `tools/`. New `Project Spec: Scaffold tools/ into workspace…` command (chained automatically from `Project Spec: Initialise Project.xml…` when the new workspace lacks `tools/`) drops the bundled tree into the workspace, with a single modal collision prompt offering Overwrite all / Skip existing / Cancel (HLR-061). At activation, when the bundled `.bundle_version` is strictly newer than the workspace's `tools/project.xsd` `version`, a one-shot information notification offers a `Re-scaffold tools/` action (HLR-062 — never an error, never blocking). New status-bar item shows `n errors / m warnings` for `doc/Project.xml`; honours `projectXml.warningsAsErrors` (escalates severity, NEVER suppresses; HLR-042); click focuses the Problems panel. Activation events widened to `onCommand:projectXml.{initProject,scaffoldTools}` so the bootstrap and scaffold flows run in an empty workspace. New `.github/workflows/publish-vsix.yml` builds the `.vsix` on `vscode-v*` tag pushes (running `prepackage` before `vsce package`), uploads it as an artifact, and gates `vsce publish` on a `VSCE_PAT` secret (no auto-publish from this commit). |
| [7](#phase-7---user-documentation-and-additional-polish) | User documentation and additional polish. | ✅ Complete |
| [8](#phase-8---add-popup-for-editing-leaf-objects) | Popup for editing leaf objects — user does not have to edit XML. | ✅ Complete |
| [9](#phase-9--create-agents) | Create agents to implement common steps of the daily workflow. | ✅ Done — agents (`ci`, `makefile`, `TracerDevelop`) and prompts (`PR`, `PrepRelease`, `Release`, `UpdateDocs`) created under `.github/`; document templates (`SAR.md.template`, `VR.md.template`, `SDP.md.template`) and `--generate-doc` CLI added to `render_doc.py`; User Manual and Developers Guide updated with new sections. |
| [10](#phase-10--refactor-vs-code-extension-providers-humble-object-pattern) | Refactor VS Code extension providers to extract testable logic (humble object pattern). | ✅ Done — Humble object pattern applied to all six providers (`LintDiagnosticsProvider`, `CoverageCodeLensProvider`, `ProjectSpecProvider`, `coverageTooltips`, `diffPreview`, `FormPanelProvider`); pure logic extracted into `lintMapping.ts`, `coverageLensLogic.ts`, `treeLogic.ts`, `coverageTooltipLogic.ts`, `diffPreviewLogic.ts`, `formLogic.ts`; providers reduced to thin VS Code API wrappers; 7 new unit-test suites added covering extracted modules. |
| [11](#phase-11--recordreplay-test-harness-for-ai-authoring-pipeline) | Record/replay test harness for AI authoring pipeline. | ✅ Done — `pipeline.record_exchange()` writes `.bundle.json`/`.response.json` fixture pairs when `TRACER_AI_RECORD_DIR` is set; 11 curated fixtures in `test/fixtures/ai_recordings/` covering every intent (including gap.fix full cascade); `test/test_ai_integration.py` replays all fixtures through translator → `apply_edit` asserting lint-clean XML and resolved placeholders; 5 previously unregistered AI test files registered in Project.xml; Developers Guide §18 documents recording mode. |
| [12](#phase-12--update-ui-tests-and-ci) | Update UI tests and CI: fix double-run on PR, stabilise ExTester UI tests with polling helpers, add provider-level integration tests with FakeSidecarClient, JUnit test-results reporting in CI. | ✅ Done |
| [13](#phase-13--static-analysis-and-vulnerabilities) | Address lint warnings and vulnerabilities; security audit report. | ✅ Done — Bandit, pip-audit, ESLint + eslint-plugin-security, npm audit, and Semgrep integrated into `tools/Makefile` (`analyze` umbrella target); `tools/analyze_report.py` generates a consolidated Markdown report from JSON outputs with `--exit-code` flag for CI gating (errors block, warnings pass); CI workflow (`ci.yml`) runs all five analyzers on every PR with a sticky comment and GitHub Step Summary; PR prompt (`PR.prompt.md`) updated to run static analysis, update SAR.md §5/§6/§7, triage Dependabot alerts via `gh api`, and update VR.md §2–§7. |
| [14](#phase-14--update-vs-code-extension-forms-to-work-with-sdd-and-stp) | Update VS Code extension forms to work with SDD and STP. | ✅ Done — `buildStpDescriptor` renders STP as a collapsible tree node with one leaf per `<fixture>` under `<stp>/<integration_environment>`; new `addStpFixture` context menu entry on the STP group node; SDD module edit form pre-populates all child fields (`purpose`, `responsibility`, `data_structures`, `algorithm`) — not just `path`/`title`; `resolveFormParams` adds a `fixture` case so coverage-hint clicks navigate to STP fixture edit forms; `ParsedSddModule` / `ParsedStpFixture` typings widened to expose child fields over the sidecar; 7 new unit tests added (treeLogic + formPanel) pinning LLR-FRM-14 and LLR-PSP-10; undici override pinned to `^6.21.1` to keep transitive dep tree clean. |


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
| **coverage** | 7.x | Dev-only. Code coverage measurement for `make -C tools coverage`. Installed via `pip install coverage`. |
| **lxml** *or* **xmllint** | any | Optional XSD validator used by the linter; lint degrades gracefully when neither is present. Recommended in CI for strict validation. |
| **Node.js** | 20 LTS | Builds the TypeScript extension and the webview bundles (forms, walkthrough, diff preview). |
| **npm** | 10 | Bundled with Node 20; used for dependency management under `tools/vscode-project-xml/`. |
| **TypeScript** | 5.x | Source language for `tools/vscode-project-xml/src/`. Installed via `npm install` from the local `package.json`. |
| **esbuild** | 0.20+ | Bundler for the extension and webviews (see `esbuild.config.js`). Installed via `npm install`. |
| **VS Code** | 1.90+ | Required for the Chat Participant API used in Phase 5 (`vscode.chat.createChatParticipant`). |
| **`@vscode/vsce`** | 2.x | Packages and (optionally) publishes the `.vsix`. Installed globally or via `npx vsce`. |
| **`vscode-extension-tester`** | 8.x | UI integration testing framework for VS Code extensions (Selenium WebDriver). Installed via `npm install` from the local `package.json`. Requires Chrome/Chromium. |
| **Red Hat XML extension** (`redhat.vscode-xml`) | latest | Declared as `extensionDependencies`; provides syntax, outline, and XSD-backed completion that this extension layers on top of. |
| **Git** | 2.30+ | Required by Phase 5.5 for `git show :1:`/`:2:`/`:3:` blob retrieval during three-way merge resolution. |
| **Chrome / Chromium** | latest | Required by `vscode-extension-tester` (ExTester) for Selenium WebDriver-based UI tests. ChromeDriver is downloaded automatically by ExTester. |
| **GitHub CLI** (`gh`) | optional | Convenience for releasing tags that trigger the `.vsix` publish workflow. |
| **Bandit** | 1.9+ | Dev-only. Python security linter (OWASP-style checks). Installed via `pip install bandit`. |
| **pip-audit** | 2.x | Dev-only. Audits Python dependencies against known CVE databases. Installed via `pip install pip-audit`. |
| **ESLint** | 9.x | Dev-only. TypeScript/JavaScript linter with `eslint-plugin-security`. Installed via `npm install` from the extension's `package.json`. |
| **Semgrep** | 1.x | Dev-only. Cross-language static analysis with community OWASP rulesets. Installed via `pip install semgrep`. |

### Bootstrapping a fresh checkout

```sh
# Python side
python3 -m venv .venv && source .venv/bin/activate
pip install jinja2 lxml coverage bandit pip-audit semgrep

# Extension side
cd tools/vscode-project-xml
npm install
npm run build      # esbuild bundle
npm run test:unit  # tier-1 Mocha unit tests (no VS Code instance)
npm run test:ui    # ExTester UI tests (launches VS Code + ChromeDriver)
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

# Chrome (required for ExTester UI tests)
# Google Chrome:
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub \
    | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] \
    http://dl.google.com/linux/chrome/deb/ stable main' \
    | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update && sudo apt install -y google-chrome-stable
# Or Chromium:
#   sudo apt install -y chromium-browser

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

# Chrome (required for ExTester UI tests)
sudo dnf install -y google-chrome-stable              # or: chromium

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

# Chrome (required for ExTester UI tests)
# Google Chrome: download from https://www.google.com/chrome/
# or: sudo pacman -S chromium

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

# Chrome (required for ExTester UI tests)
brew install --cask google-chrome                    # or: brew install chromium

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
google-chrome --version \
    || chromium --version  # required for UI tests (ExTester)
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
    Developers_Guide.md §15 documents `<plan>` as the example
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
    [Developers_Guide.md](../tools/Developers_Guide.md) alongside §15
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
> `Developers_Guide.md`, and bump `schema_version` to 1.4. Extend
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

Phase 5 is split into two sub-phases so the Python pipeline can land
and be exercised end-to-end on its own (`echo … | python3
tools/project_io.py` plus a stubbable model callback) before the
TypeScript chat / diff / settings surfaces are wired in. Both
sub-phases together are required for the [PVD §8](PVD.md) AI-grounded
authoring success metric; neither is optional.

*   **Phase 5a — Python grounding & pipeline.** `tools/ai/` package
    (context packer, validate→retry pipeline, intent registry, JSON
    Schemas + prompts for all 10 intents, deterministic per-intent
    translators, provenance writer), `ai_request` JSON-RPC method
    on `project_io.py`, and the `aiActions` projection on
    `ui_hints_index` (so Phase 5b's tree menu is schema-driven from
    the moment it lands per [HLR-053](HLRs.md)). Self-contained:
    no TypeScript edits, no model calls from Python — the LM
    callback is injected by the caller (the Phase 5b participant or
    the test harness).
*   **Phase 5b — TypeScript surfaces.** `@projectspec` chat
    participant via `vscode.chat.createChatParticipant`, the nine
    slash commands, the schema-driven right-click tree menu, the
    `broken-trace` AI-suggest Quick Fix variant, the diff-preview-
    and-apply flow with backup, the `projectXml.ai.*` settings UI,
    and the graceful-degradation gates (HLR-044/HLR-045).

#### Phase 5a — Python grounding & pipeline

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
    PVD edits). The model callback is injected by the caller — the
    Python sidecar never imports an LM client.
5.  **`aiActions` projection on `ui_hints_index`.** The sidecar's
    `ui_hints_index` and `parse_to_json` responses gain a per-
    complex-type `ai_actions: [intent_id, …]` field derived from
    the intent registry's `targets` so Phase 5b's tree context
    menu is schema-driven from the moment it lands (per
    [HLR-053](HLRs.md), carry-forward contract from Phase 2.5b).
6.  Acceptance (Phase 5a):
    *   `echo '{"method":"ai_request","params":{"intent":"draft.hlr",
        "target":{"section":"1"}}}' | python3 tools/project_io.py`
        with a stubbed model callback returns either an applied
        JSON Patch + clean lint or a rejected suggestion + the
        validator findings — never a write to `Project.xml` on
        failure.
    *   The grounding bundle's schema and user-intent fields survive
        an aggressively low `max_tokens` cap (the deterministic
        packer drops examples and sibling lists first).
    *   Every authoring intent's translator produces operations
        consumable by `apply_edit` without TypeScript involvement.
    *   The `aiActions` field on each `ui_hints_index` entry
        correctly enumerates the intents that target that complex
        type.

#### Phase 5b — TypeScript surfaces

Depends on Phase 5a's `ai_request` sidecar method and `aiActions`
projection.

1.  TypeScript side: `ai/participant.ts` registers the
    `@projectspec` chat participant via
    `vscode.chat.createChatParticipant`. Slash commands cover the
    full intent matrix: `/draft-hlr`, `/draft-llr`, `/draft-test`,
    `/draft-module`, `/draft-pvd`, `/expand`, `/review`,
    `/suggest-traces`, `/gap-fill`. The chat participant supplies
    the model callback that Phase 5a's pipeline expects.
2.  **Schema-driven AI tree menu** (per [HLR-053](HLRs.md), carry-
    forward contract from Phase 2.5b). Right-click context-menu
    entries on every Project Spec tree node — `Draft …`,
    `Expand …`, `Review with AI`, `Suggest traces with AI`,
    `Fix gap with AI` — are derived from the `ui_hints_index`
    `aiActions` projection shipped in Phase 5a, **not** hard-coded
    per element name. A new payload kind that adds a `ui:treeNode`
    hint inherits the applicable AI surface for free.
3.  AI-suggest Quick Fix variants on the Phase 2.5c Quick Fix table
    (e.g. "AI: suggest correct ref" on `broken-trace`).
4.  Diff-preview-and-apply flow with backup + provenance log
    (`.edit_doc/ai_history.jsonl`) per [HLR-032](HLRs.md) and
    [HLR-033](HLRs.md). `projectXml.ai.autoApplyValidated`
    defaults to `false` and is honoured even for fully-validated
    suggestions.
5.  Settings UI for the `projectXml.ai.*` block.
6.  **Graceful degradation and trust gating** (per
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
7.  Acceptance (Phase 5b):
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
3.  **Bundled Python tooling** (per [HLR-060](HLRs.md)). The `.vsix`
    ships a copy of every Python file required at runtime —
    `project_io.py`, `render_doc.py`, `lint_project.py`,
    `project_edit.py`, `project_merge.py`, `project.xsd`, the
    `templates/` directory, and the `ai/` package — under
    `dist/python/` inside the extension. A `prepackage` npm script
    copies the canonical `tools/` tree into `dist/python/` immediately
    before `vsce package`; the same script removes `dist/python/`
    from `.vscodeignore` so the bundled copy survives packaging.
    `getToolsDir()` falls back to `<extensionPath>/dist/python` when
    no workspace `tools/` is configured or found, so the extension
    works in any workspace as long as a Python 3.10+ interpreter
    with `jinja2` (and optionally `lxml`) is on PATH or configured
    via `projectXml.pythonPath`. Activation is widened from
    `workspaceContains:doc/Project.xml` to also include
    `onCommand:projectXml.initProject` and
    `onCommand:projectXml.scaffoldTools` so the extension can run
    in an empty workspace.
4.  **Workspace scaffolder** (per [HLR-061](HLRs.md)). A new
    `projectXml.scaffoldTools` command — also invoked automatically
    at the end of a successful `projectXml.initProject` flow when the
    target workspace lacks a `tools/` directory — recursively copies
    `<extensionPath>/dist/python/` into the workspace's
    `<projectXml.toolsDir>` (default `tools/`). Files that already
    exist in the workspace are skipped unless the user explicitly
    confirms an overwrite via a modal prompt. After scaffolding the
    new workspace is self-contained: the CLI (`make validate-xml`,
    `python3 tools/render_doc.py …`), CI, and other contributors who
    do not have the extension installed all work without further
    setup, and the Red Hat XML extension's
    `xsi:noNamespaceSchemaLocation="tools/project.xsd"` resolves
    locally.
5.  **Bundle freshness check** (per [HLR-062](HLRs.md)). The
    `prepackage` script writes the source `tools/project.xsd`
    `schema_version` into `dist/python/.bundle_version` at package
    time. At activation the extension compares that pinned version
    against the workspace's `tools/project.xsd` (when present) and
    surfaces a one-shot information notification — never an error —
    if the workspace's bundled `tools/` is older than the
    extension's, offering a `Re-scaffold tools/` action that
    re-invokes `projectXml.scaffoldTools` with overwrite confirmed.
    The workspace's pin is authoritative for sidecar spawn; the
    extension never silently rewrites workspace `tools/` files.
6.  Marketplace listing assets (icon, screenshots, animated GIF).
7.  CI to publish `.vsix` on tag. The publish workflow runs the
    `prepackage` script before invoking `vsce package` so the
    bundled `dist/python/` is present in every shipped `.vsix`.

**AI prompt:**
> Finish the extension for public release. Surface every
> `projectXml.*` setting through `contributes.configuration` with
> clear titles, descriptions, and the defaults documented in SDD
> §21 “Compile-time constants”. Add a status bar item that
> subscribes to lint results and displays `n errors / m
> warnings`, clickable to open the Problems panel filtered to
> `Project.xml`; warnings must be displayed verbatim and never
> hidden, per [HLR-042](HLRs.md) — `projectXml.warningsAsErrors`
> may escalate severity but must not suppress.
>
> Make the `.vsix` self-contained per HLR-060/061/062. Add an npm
> `prepackage` script under `tools/vscode-project-xml/` that
> recursively copies `tools/project_io.py`, `render_doc.py`,
> `lint_project.py`, `project_edit.py`, `project_merge.py`,
> `project.xsd`, `templates/`, and `ai/` into
> `tools/vscode-project-xml/dist/python/` and writes the source
> XSD's `schema_version` into `dist/python/.bundle_version`;
> remove `dist/python/` from `.vscodeignore` so the bundled copy
> survives `vsce package`. Teach `getToolsDir()` in
> `src/util/paths.ts` to fall back to
> `context.extensionPath + '/dist/python'` when no workspace
> `tools/` is configured or found, and widen
> `activationEvents` to include
> `onCommand:projectXml.initProject` and
> `onCommand:projectXml.scaffoldTools`. Add a
> `projectXml.scaffoldTools` command that recursively copies the
> extension's bundled `dist/python/` into the workspace's
> `<projectXml.toolsDir>` (skipping existing files unless the user
> confirms overwrite via a modal prompt) and have
> `projectXml.initProject` invoke it automatically at the end of
> a successful bootstrap when the target workspace lacks a
> `tools/` directory. At activation, when the workspace contains
> a `tools/project.xsd`, compare its `schema_version` against
> `dist/python/.bundle_version` and surface a one-shot information
> notification — never an error — offering a `Re-scaffold tools/`
> action when the workspace bundle is older. The workspace's pin
> remains authoritative; never silently rewrite workspace `tools/`
> files.
>
> Produce Marketplace assets under
> `tools/vscode-project-xml/media/`: a 128×128 icon, at least
> three screenshots covering the tree view, a form panel, and the
> render/preview flow, plus an animated GIF of the Walkthrough
> end to end. Add a GitHub Actions workflow that builds and
> publishes the `.vsix` on tag pushes matching `vscode-v*`,
> running the `prepackage` script before `vsce package` so the
> bundled `dist/python/` ships in every release; (optionally)
> `vsce publish` gated on a repository secret. Do not publish to
> the Marketplace from this prompt — only wire the CI.

### Phase 7 - User Documentation and additional polish
1. Write a user manual with the following sections: Overview,
   Installation, Getting Started, VS Code Extension,
   Command Line Tools, and Example Workflow. This document should
   be in the ./tools directory. 
2. Convert the Schema_Reference.md into a Developer's Guide,
   move it to the ./tools directory, and fix up any links to/from
   other documents. The document should address users that want
   to create their own generated documents and users that maintain
   or contribute to this repository. Move the schema to
   Appendix A of the document. This document should also be in
   the ./tools directory.
3. Update the .vsix installation package to include these new
   documents.
3. Move the status from the ./README.md to the top of the
   SDP.md.
4. Replace the current ./README.md with an overview of the
   TraceR product. Keep the graphic.

AI Prompt:
> Write a user manual with the following sections: Overview,
> Installation, Getting Started, VS Code Extension,
> Command Line Tools, and Example Workflow. This document should
> be in the ./tools directory.
> Convert the Schema_Reference.md into a Developer's Guide,
> move it to the ./tools directory, and fix up any links to/from
> other documents. The document should address users that want
> to create their own generated documents and users that maintain
> or contribute to this repository. Move the schema to
> Appendix A of the document. This document should also be in
> the ./tools directory.
> Update the .vsix installation package to include these new
> documents.
> Move the status from the ./README.md to the top of the
> SDP.md. Replace the current ./README.md with an overview of the
> TraceR product. Keep the graphic.

### Phase 8 - Add popup for editing leaf objects
1. Update the PVD to state a goal is the user will not have to
   edit XML. The product will open a dialog box with editable
   fields when the user double clicks on an editable object in
   the tree view. At the top of the dialog box, it will display
   the same information found in the tooltip for that object.
   These will be hot links to those linked object. Following
   a link will close the current dialog box and open a new one
   for the linked object. 

### Phase 9 — Create agents
Create the following agents and prompts

1. CI.agent.md - This agent will query the user and implement the CI workflow they would like. This may include build and test on push, build a release package using the provided version when a release is created, 
2. Makefile.agent.md - This agent will help create and maintain a makefile. It will prompt the user for the targets the want and implement them. It will use the help hack. And it can be used to add new targets to the makefile
3. UpdateSpecs.agent.md - This agent looks at the work done on the current branch to date and updates the PVD and SDP, and SDD, HLRs, LLRs, and Tests in Project.xml. This includes updating the prereqs in the SDP and STP
4. TracerDevelop.agent.md - This agent is an expert at Python, Python Libraries, Vs Code extension development, typescript, and is familiar with the Tracer architecture (Developers_Guide, SDD, and Project.xsd)
 
5. PR.prompt.md - This prompt will Read current branch name, open GitHub issues and update the Phased Delivery and Status sections of the SDD, take all of the updates in the current branch and create a commit message, commit the branch, push the branch, and create a pull request
6. PrepRelease.prompt.md (Add VERSION) - This prompt creates releases. It displays the current recent release number and prompts for the new one. It then creates a new release branch, updates the VERSION file, checks the Dependabot vulnerability alerts, where possible dismisses them with justification, when applicable add to the vulnerabilities report, generate a commit message, commit, push, create PR.  
7. Release.prompt.md - Create a release w/VERSION and include release notes

### Phase 10 — Refactor VS Code extension providers (humble object pattern)
1.  Apply the humble object pattern to each low-coverage provider
    (`LintDiagnosticsProvider`, `CoverageCodeLensProvider`,
    `ProjectSpecProvider`, `coverageTooltips`, `diffPreview`,
    `FormPanelProvider`).
2.  Extract pure decision-making logic into standalone modules
    (e.g. `src/forms/formLogic.ts`, `src/treeView/treeLogic.ts`,
    `src/diagnostics/lintMapping.ts`).
3.  Keep provider classes as thin wrappers that call the extracted
    functions and pass results to VS Code APIs.
4.  Write mocha unit tests for the extracted modules covering the
    paths currently untested.
5.  Acceptance: extension coverage reaches ≥80% line coverage;
    `make -C tools ext-coverage` passes; no functional regressions.

### Phase 11 — Record/replay test harness for AI authoring pipeline
1.  Add a `TRACER_AI_RECORD_DIR` env var to `pipeline.py`. When set,
    write each model response (raw JSON) plus the input bundle to a
    fixture directory as paired `.bundle.json` / `.response.json`
    files, named by intent and timestamp.
2.  Create `test/fixtures/ai_recordings/` with a curated set of
    captured responses covering the key intents: `draft.hlr`,
    `draft.llr`, `draft.test`, `gap.fix` (including cascading),
    `suggest.traces`, `review.item`, and `expand.*`.
3.  Add `test/test_ai_integration.py` that loads each fixture pair,
    calls the translator with the recorded response, applies the
    resulting ops to a known-good `Project.xml` snapshot, and asserts
    the output XML is valid (lint-clean) with expected elements and
    correctly resolved placeholder refs.
4.  Acceptance: all fixtures replay through translator → `apply_edit`
    producing lint-clean XML; no dependency on a live model or network
    access during `make -C tools test-py`.

### Phase 12 — Update UI Tests and CI
1.  Fix the CI double-run issue: narrow `push.branches` from `['**']`
    to `[develop]` in `.github/workflows/ci.yml` so PRs only trigger
    the `pull_request` event, not both `push` and `pull_request`.
2.  Stabilise the ExTester UI tests (`treeView.test.ts`,
    `editor.test.ts`, `aiTreeMenu.test.ts`) that fail ~30% of the
    time in CI but not locally: replace all hard-coded
    `driver.sleep()` waits with condition-based polling helpers,
    add `retryOnStale()` for context-menu interactions, add
    `this.retries(2)` to each suite.
3.  Extract shared UI test helpers into `test/ui/helpers.ts`:
    `dismissWelcomeOverlay`, `getProjectSpecSection`,
    `expandGroup`, `waitForTreeItem`, `waitForEditorTab`,
    `retryOnStale`, `waitForNotification`.
4.  Add UI test workspace settings (`enablePreview: false`,
    `newWindowDimensions: maximized`) to reduce flakiness.
5.  Create `FakeSidecarClient` (`test/unit/__mocks__/fakeSidecar.ts`)
    as a test double for `ProjectIoClient`, enabling provider-level
    integration tests without a running Python sidecar.
6.  Extend the hand-rolled `vscode` mock with `Uri.scheme`/`path`
    parsing, `languages.createDiagnosticCollection`,
    `workspace.openTextDocument`, and hierarchical
    `affectsConfiguration`.
7.  Add provider-level integration tests ("Tier 1.5") for:
    `LintDiagnosticsProvider` (8 tests),
    `MarkdownPreviewProvider` (9 tests),
    `AiCapabilityProvider` (9 tests),
    `ProjectSpecProvider` (8 tests).
8.  Register the new test files and the previously unregistered
    `aiTreeMenu.test.ts` in `doc/Project.xml`.
9.  Add JUnit test-results reporting to CI, mirroring the existing
    coverage report pipeline: `unittest-xml-reporting` for Python,
    `mocha-junit-reporter` + `mocha-multi-reporters` for extension
    unit tests, `tools/test_results_report.py` consolidation script,
    Makefile targets (`test-py-junit`, `ext-test-unit-junit`,
    `test_report`), and three CI steps (generate XML, post to step
    summary, sticky PR comment with `header: test-results`).
10. Acceptance: `npx tsc -p tsconfig.test.json --noEmit` and
    `npx tsc -p tsconfig.uitest.json --noEmit` compile cleanly;
    `npm run test:unit` passes all tests (341); `make -C tools
    test-py` passes all tests (174); CI runs exactly once per PR;
    `make -C tools test_report` produces a consolidated Markdown
    report.

### Phase 13 — Static Analysis and Vulnerabilities
1. Install Bandit + pip-audit for the Python side (tools),
   ESLint + eslint-plugin-security + npm audit for the extension
   (vscode-project-xml), Semgrep across both (single tool,
   community OWASP rulesets), add them to the prereqs in the
   makefile
2. Create an analyze target in the makefile that runs the static
   code analyzers. These targets should be compatible with the
   GitHub CI. The target also runs a script that summarizes the
   output of all the analyzers
3. Add the static analyzers to the Pull Request CI pipeline with
   the report working like the test results and code coverage
   analysis
4. Update the PR prompt so it updates the Security Audit Report
   from the static analysis and analyzes the Dependabot
   vulnerabilities, determines if they are applicable, updates
   them on GitHub, and updates the Vulnerability Report

### Phase 14 — Update VS Code Extension Forms to Work with SDD and STP
1. Extend `buildStpDescriptor` so the STP tree group renders as a
   collapsible node `STP (N fixtures)` whose children are the
   `<fixture>` elements under `<stp>/<integration_environment>`,
   each carrying `editArgs` for the schema-driven popup edit
   dialog (LLR-PSP-10).
2. Add an `addStpFixture` context-menu entry on the STP group
   (`viewItem == stpGroup`) and extend the existing
   `renderAndPreview` menu predicate so the STP group is
   render-and-previewable from the tree (parity with `hlrsGroup`,
   `llrsGroup`, `testsGroup`, `sddGroup`).
3. Fix the SDD module edit form so it pre-populates ALL child
   element fields declared in the XSD `<ui:form>` annotation
   (`purpose`, `responsibility`, `data_structures`, `algorithm`)
   in addition to the attribute fields (`path`, `title`) — both
   when opened via `editPayload` from the tree and when opened
   via `resolveFormParams` from a coverage-hint click
   (LLR-FRM-14). Multi-valued children (e.g. multiple
   `<responsibility>` elements) are joined with newline separators
   so the textarea widget displays them as a block.
4. Add a `fixture` case to `resolveFormParams` so coverage-hint
   clicks on STP fixtures resolve to an `OpenFormParams` with
   `type='StpFixture'`, `basePath='/stp/integration_environment/fixture[name=X]'`,
   and `initial` containing `name` and `source` fields
   (LLR-FRM-11 extension).
5. Widen the sidecar typings (`ParsedSddModule`, `ParsedStpFixture`,
   `ParsedStp.integration_environment.fixtures`) so the new child
   fields are exposed through `parse_project_xml` over JSON-RPC.
6. Add `StpFixture` to `COVERED_TYPE_KEYS` so STP fixtures get
   coverage-badge propagation alongside HLR/LLR/Test/SddModule.
7. Add unit-test coverage: `buildSddDescriptor` includes child
   element fields in `editArgs.formData`; `buildStpDescriptor`
   renders fixtures as editable children; `buildOperations`
   emits replace ops for `SddModule` child fields and
   `StpFixture` attrs in edit mode; `resolveFormParams` handles
   the new `fixture` tag plus the not-found case; the SDD module
   locator test asserts the full `initial` payload.
8. Pin `undici` override to `^6.21.1` in the extension
   `package.json` so the transitive dep tree stays on the
   currently-clean major; refresh `package-lock.json`.
9. Acceptance: tree shows STP fixtures as editable leaves;
   double-clicking an SDD module or STP fixture opens the edit
   form pre-populated; right-clicking the STP group offers
   `Add STP Fixture`; existing tests stay green; the seven new
   unit tests pass.

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

Phases 0–8 are complete and form the baseline product
([PVD §5, §7.1](PVD.md)). Phases 9–12 and the TBD phase are
post-baseline improvements tracked as open GitHub issues.

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
| 7 | User documentation and polish | Markdown + npm packaging | small | release-only |
| 8 | Popup for editing leaf objects | TS + React (webview) | medium | ✅ |
| 9 | Create agents | AI agent config | small | post-baseline |
| 10 | Refactor providers (humble object) | TypeScript | medium | post-baseline |
| 11 | Record/replay AI test harness | Python | medium | post-baseline |
| 12 | SDP template | Python + Jinja2 | small | post-baseline |
| 13 | Lint warnings + security audit | Python + toolchain | small-medium | post-baseline |
| 14 | SDD/STP form completeness | TypeScript | small | post-baseline |

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
