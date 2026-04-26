# Product Vision Document: TraceR (TR)

**Version:** 0.1
**Date:** 2026-04-23
**Author(s):** John Anderson

## 1. Purpose

This Product Vision Document (PVD) defines *why* `TR` exists, *who*
it is for, *what* problem it solves, and the *measurable outcomes*
that determine whether it is succeeding. It sits above the
[Software Design Document](SDD.md), [High-Level
Requirements](HLRs.md), [Low-Level Requirements](LLRs.md), and
[Software Test Plan](STP.md), and is the document the rest of the
specification stack must remain aligned with.

When in doubt about a feature, scope decision, or trade-off, this
document is the reference.

## 2. Vision Statement

> **A small team can ship a software project whose design,
> requirements, low-level requirements, and tests are demonstrably
> in lockstep — without anyone hand-maintaining a traceability
> matrix.**
>
> The user is a developer (or a developer-led team) who wants the
> rigour of a traceable specification stack but cannot afford the
> overhead of authoring and reconciling five separate Word
> documents. With `TR`, they edit one structured source from inside
> their editor — with structured tree views, form panels, inline
> validation, quick-fixes, and schema-grounded AI assistance for
> drafting and review — and the SDD, HLRs, LLRs, STP, and
> end-to-end traceability matrix are regenerated on demand and
> re-verified on every commit.
## 3. Problem Statement

Today, teams that want a traceable specification stack either pay
the full cost of an industrial requirements-management tool (DOORS,
Polarion, Jama) or hand-author Markdown/Word documents and try to
keep them in sync by review. Both approaches scale poorly for a
small team and neither plays well with the everyday code-review
workflow.

*   The four spec documents (SDD, HLRs, LLRs, STP) drift apart the
    moment they are committed; cross-references rot silently.
*   "Show me the test that covers this requirement" cannot be
    answered without a manual scan, so coverage gaps go unnoticed
    until audit time.
*   Renumbering an HLR or LLR is a global find-and-replace risk;
    nobody does it, so identifiers ossify in awkward shapes.
*   Merging two branches that each touched `Project.xml` produces
    textual Git conflicts in regions that are not actually in
    semantic conflict (different HLRs in the same section, new
    traces on the same item) — and resolving them by hand risks
    silently dropping a requirement.
*   Heavyweight RM tools impose a UI, a database, and a licence —
    none of which sit naturally next to source code in Git.
*   Markdown-only stacks have no schema, so the same field is
    spelled five ways across five projects and no tooling can
    reason about them.

The cumulative effect is that small teams either skip traceable
specs entirely (and lose the engineering discipline that produces)
or invest disproportionate effort to maintain them by hand.

## 4. Target Users

| Persona | Needs from `TR` |
| ------- | --------------- |
| **Developer-author** | Edit one structured file in their normal editor, regenerate every spec doc with one command, resolve merge conflicts on `Project.xml` without dropping requirements, and let CI fail the build if traceability breaks. |
| **Tech lead / reviewer** | See in a pull request exactly which HLRs, LLRs, and tests changed, and whether coverage regressed — without leaving GitHub. |
| **QA / verification engineer** | Read a generated Software Test Plan and Traceability Matrix that always matches the code under test, and add new tests with traceability annotations as they write them. |
| **Auditor / external stakeholder** | Open a single Markdown traceability matrix in the repository and see, end-to-end, which requirements are covered by which tests and which gaps are explicitly acknowledged. |
| **Tooling integrator** | Drive `TR` programmatically (JSON-RPC over stdio) from editors, web forms, or CI scripts without re-implementing its parsing or rendering logic. |

`TR` is **not** aimed at: large regulated programmes that already
mandate DOORS/Polarion; project managers tracking schedule and
resourcing; product managers writing market-facing roadmaps; or
teams whose specifications live entirely in tickets.

## 5. Value Proposition

`TR` lets a developer maintain a fully traceable, auditable
specification stack from a single structured source, by doing eight
things, in order:

1.  **One source of truth.** `doc/Project.xml` holds the SDD, HLRs,
    LLRs, test annotations, and every cross-reference; nothing in
    the generated docs is authoritative.
2.  **Generated documents.** `tools/render_doc.py` produces
    `SDD.md`, `HLRs.md`, `LLRs.md`, `STP.md`, and `Traceability.md`
    from Jinja2 templates against the XML — the documents are never
    edited by hand.
3.  **Computed traceability.** Every `<traces>` block on an HLR,
    LLR, or test is composed by the renderer into a forward and
    reverse SDD → HLR → LLR → Test matrix; coverage gaps are listed,
    not hidden.
4.  **Built-in linting.** `tools/lint_project.py` validates the XML
    against the XSD and checks ID format, uniqueness, broken
    references, and missing coverage — runnable locally and in CI.
5.  **In-editor authoring.** A first-class VS Code extension turns
    `Project.xml` into a structured editing surface: tree views per
    payload, code lenses, form panels for HLRs/LLRs/tests, inline
    diagnostics from the linter, quick-fixes for the most common
    findings, and a guided walkthrough for new projects. Developers
    never have to write XML by hand. The extension's surfaces are
    **schema-driven**: tree nodes, form panels, code lenses, the
    Markdown-preview document list, and the render commands are
    built at runtime from `tools/project.xsd` (UI hints in
    `xs:appinfo`) and `<metadata><document>` entries in
    `Project.xml`, not from hard-coded payload knowledge.
6.  **AI-assisted authoring.** A schema-grounded, lint-validated AI
    layer drafts HLRs, expands LLRs from HLRs, drafts test purposes
    from LLRs, reviews items against their upstream context, and
    proposes fixes for coverage gaps — reachable from a
    `@projectspec` chat participant, right-click actions in the tree
    view, and quick-fixes on lint diagnostics. Every AI-authored
    edit is grounded in the project's own PVD/SDD/payloads, gated
    on the same XSD + lint pipeline as manual edits, and previewed
    via diff before being applied.
7.  **Structured merge resolution.** When two branches both touch
    `Project.xml`, the extension does a deterministic three-way
    structural merge keyed on element IDs (HLR/LLR/test/module),
    unions traces, and recomputes counts — clearing the vast
    majority of conflicts with no AI involvement. Genuinely
    overlapping body edits are surfaced in VS Code's merge editor
    with optional AI-suggested resolutions, all gated on the same
    XSD + lint validation.
8.  **Programmatic access.** A long-running JSON-RPC server
    (`tools/project_io.py`) exposes the same parse/render/lint/init
    operations to editors, web forms, and AI assistants so every
    surface speaks one canonical backend.

The unifying design choice: **the spec documents are an output, not
an input.** Every authoring tool — CLI, web form, VS Code
extension, AI assistant — edits the structured source and lets the
renderer produce the prose.

## 6. Product Principles

These principles are the tie-breakers when requirements conflict.

1.  **Single source of truth.** `Project.xml` is authoritative.
    Generated documents (`SDD.md`, `HLRs.md`, `LLRs.md`, `STP.md`,
    `Traceability.md`) are never hand-edited; any change made to
    them is silently lost on the next render. This rules out
    "quick fixes" applied to the Markdown.
2.  **Plain text, plain Git.** Inputs and outputs are text files in
    the repository. `TR` introduces no database, no server, no
    binary store, and no proprietary format. This rules out any
    feature that would require a runtime service to read the spec.
3.  **Schema before tooling.** Every payload field is described in
    `tools/project.xsd` and `tools/Developers_Guide.md` before
    any template, renderer, or UI consumes it. Schema bumps are
    versioned (`schema_version`). This rules out ad-hoc XML tags
    introduced by one tool.
4.  **Minimal dependencies.** The core renderer and linter use only
    the Python standard library plus Jinja2; XSD validation falls
    back gracefully when `lxml`/`xmllint` are absent. This rules
    out adding heavy dependencies to the spec-generation hot path.
5.  **One backend, many surfaces.** CLI, web form, VS Code
    extension, and AI assistance all call the same Python functions
    — directly or via the JSON-RPC sidecar. UI layers never
    re-implement parsing, rendering, or linting. This rules out
    duplicate validation logic in TypeScript or in browser code.
6.  **No hand-written XML on the critical path.** Routine authoring
    — adding an HLR, an LLR, a test, or an SDD module — is doable
    end-to-end through the VS Code extension's structured surfaces.
    The raw XML remains a supported escape hatch, but a workflow
    that *requires* the user to edit XML by hand to perform a
    common task is a bug.
11. **Schema-driven surfaces.** Adding a new generated document, a
    new payload section, or a new field is a schema-and-template
    change — not a TypeScript change. The VS Code extension
    discovers what to render (tree nodes, forms, lenses, preview
    targets, render commands) from `tools/project.xsd` UI hints
    and `<metadata><document>` entries. Bespoke visualisations and
    domain-specific lint rules are the only payload-aware code
    paths; everything else is generic. This rules out hard-coding
    new payload types into the extension just to make them
    editable.
7.  **AI as a co-author, not an oracle.** AI-generated content is
    grounded in the project's own data (PVD, SDD, existing
    payloads, schema), constrained by a typed JSON response
    schema, and validated through the same XSD + lint pipeline as
    manual edits before it can be applied. Every AI write is
    previewed as a diff and logged to `.edit_doc/ai_history.jsonl`
    for provenance. AI is never a silent author; the linter, not
    the model, is the authority on correctness.
8.  **Fail loud, never silently drift.** Every broken trace,
    duplicate ID, or unverified requirement is surfaced by the
    linter. Coverage gaps appear in the Traceability Matrix as
    explicit rows. This rules out warnings being downgraded to
    pass-through to keep CI green.
9.  **Stable identifiers.** `HLR-NNN` and `LLR-XXX-NN` IDs are
    contracts. They are never renumbered; new IDs take the next
    free number. This rules out "just renumbering for tidiness"
    refactors.
10. **Verifiable.** Every behaviour worth describing is captured as
    an HLR/LLR with at least one bound test. The
    [Traceability Matrix](Traceability.md) is the contract.

## 7. Scope

### 7.1 In Scope

*   A versioned XML schema (`tools/project.xsd`) covering the SDD,
    HLRs, LLRs, STP, test catalogue, and cross-reference traces.
*   A renderer (`tools/render_doc.py`) that produces all five spec
    Markdown documents from one `Project.xml` plus Jinja2 templates.
*   A linter (`tools/lint_project.py`) covering well-formedness,
    XSD conformance, ID format/uniqueness, broken trace references,
    and forward/reverse coverage gaps.
*   A `--init` mode that bootstraps a new project's `Project.xml`
    and `PVD.md` from skeletons.
*   A long-running JSON-RPC 2.0 server (`tools/project_io.py`)
    exposing `lint`, `render`, `parse_to_json`, and `init_project`
    over stdin/stdout.
*   A first-class **VS Code extension** that is part of the
    baseline product, not an optional add-on. It contributes a
    "Project Spec" tree view (HLRs / LLRs / Tests / SDD / STP),
    inline diagnostics wired to the linter, code lenses showing
    coverage status on every `<hlr>`/`<llr>`/`<test>`, form panels
    for editing single payload items without touching XML, a
    side-by-side rendered Markdown preview, a guided walkthrough
    for bootstrapping new projects, and quick-fixes for the most
    common lint findings (broken trace refs, ID-format errors).
    All of these surfaces are **schema-driven**: the tree, form
    panels, code lenses, preview targets, and `Render <Doc>`
    commands are built at runtime from `tools/project.xsd` UI
    hints (`xs:appinfo`) and the `<metadata><document>` list, so
    that adding a new generated document or payload section does
    not require an extension code change. Bespoke widgets and
    domain-specific lint rules remain the only payload-aware code
    paths. Distributed as a `.vsix` and (optionally) on the
    Marketplace. See [doc/SPD.md](SPD.md) for the phased delivery
    plan (Software Plan Document).
*   **Structured three-way merge resolution** for `Project.xml`,
    delivered as part of the baseline product. A deterministic
    structural merger handles non-overlapping additions, trace
    unions, count recomputation, and ID collision avoidance with
    no AI involvement; residual semantic conflicts (overlapping
    body edits, divergent trace targets, ID renames, schema-version
    bumps) are surfaced in VS Code's three-way merge editor with
    optional AI-suggested resolutions, every candidate gated on the
    XSD + lint pipeline. There is no auto-apply path — the merge
    editor is the only commit surface.
*   **AI authoring assistance** as a baseline VS Code feature —
    schema-grounded drafting, expansion, review, and gap-filling
    — reachable from the `@projectspec` chat participant
    (`/draft-hlr`, `/expand`, `/review`, `/gap-fill`,
    `/resolve-conflicts`), right-click actions in the tree view,
    and quick-fixes on lint diagnostics. Every AI response is a
    typed JSON object validated against an intent schema, applied
    only after passing the XSD + lint pipeline, previewed as a
    diff, and logged to `.edit_doc/ai_history.jsonl`. The feature
    degrades gracefully when no chat-model API is available and is
    fully disabled in untrusted workspaces.
*   A standalone web form (planned, see
    [PLAN_web_form.md](../tools/PLAN_web_form.md)) for
    non-developer contributors, sharing the same backend.
*   A self-hosted demonstration: `TR` itself ships with its own
    populated `Project.xml`, generated specs, and traceability
    matrix.

### 7.2 Out of Scope

*   Industrial-strength requirements management (baselining,
    workflow approvals, change-request governance, electronic
    signatures).
*   Real-time multi-user editing or row-level locking on
    `Project.xml`. Concurrent edits are reconciled at merge time
    via the structured merge resolver (§7.1), not by a live
    collaboration server.
*   Issue/ticket tracking, sprint planning, or schedule management.
*   Output formats other than Markdown (no DOCX, PDF, HTML, or
    DITA generation in core; users can render the Markdown
    themselves).
*   Hosting `Project.xml` in a database; the file lives in the
    repository.
*   Parsing or generating code from `Project.xml`; the spec stack
    is descriptive, not executable.
*   Automatic semantic verification of requirement *content* (e.g.
    "is this HLR well-written?") beyond what the linter can
    mechanically check; the AI authoring layer offers advisory
    review (`/review`) but is never the authority on correctness
    — only the XSD + linter are.

### 7.3 Non-Goals

*   Becoming a competitor to DOORS, Polarion, or Jama. `TR` is
    explicitly the lightweight, repo-native alternative for teams
    that do not need (and cannot justify) those tools.
*   Adopting a proprietary file format, schema dialect, or
    serialisation that cannot be read by `xmllint` and a text
    editor.
*   Becoming a programming-language-specific tool. The schema and
    renderer are language-agnostic; only the `<test>` annotation
    convention is per-test-framework.
*   Replacing the developer's editor, version-control system, or
    CI provider.

## 8. Success Metrics

`TR` is succeeding when:

| Metric | Target |
| ------ | ------ |
| **Single-edit propagation** | A user can add or change one HLR, LLR, or test in `Project.xml` and regenerate every affected spec document with one command in well under a minute on a developer laptop. |
| **Lint-clean main** | The repository's own `Project.xml` lints with zero errors on every commit to `main`; any warning is either resolved or explicitly acknowledged as a documented gap in `Traceability.md`. |
| **Computed coverage** | Every HLR and LLR that is not covered by a test appears as an explicit row in the generated Traceability Matrix; the count matches `lint_project.py`'s coverage warnings exactly. |
| **In-editor authoring** | A developer can add an HLR, an LLR, or a test — with full traces — from the VS Code extension's form panels, see it appear in the tree view, the rendered Markdown preview, and the lint results, without ever opening `Project.xml` in a text editor. |
| **Conflict-free merges** | A pull request that adds non-overlapping HLRs/LLRs/tests on top of `main` merges through the structured resolver with zero residual conflicts and no new lint errors. Overlapping body edits surface in the merge editor with an explicit AI suggestion; nothing is silently auto-applied. |
| **AI-grounded authoring** | A user can invoke `@projectspec /draft-hlr <intent>` (or the equivalent right-click action) and receive a schema-valid HLR with at least one plausible SDD trace, on the first response, in well over 90% of attempts. AI responses that fail XSD or lint are auto-retried with the findings as feedback and never silently applied. |
| **One-backend invariant** | The CLI, JSON-RPC sidecar, VS Code extension, and web form return identical lint findings and identical rendered Markdown for the same `Project.xml`. Divergence is a release-blocking bug. |
| **Bootstrap time** | A developer can go from `git clone` to a populated `Project.xml` and a fully generated five-document spec stack in under five minutes by running the VS Code extension's guided walkthrough (or, equivalently, the `--init` CLI flow). |
| **Schema-driven extensibility** | A new generated document (or a new payload section with UI hints) can be added to a project by editing only `tools/project.xsd`, `Project.xml`, and a Jinja2 template under `tools/templates/`. The VS Code extension picks up the new tree nodes, form panels, preview target, and render command on next reload with zero TypeScript changes. |
| **Self-host quality** | `TR`'s own SDD, HLRs, LLRs, STP, and Traceability Matrix are the canonical reference example. Coverage of `TR`'s own LLRs by `TR`'s own tests is at or above 95%. |

## 9. Roadmap Themes

These are *themes* — not committed features — that frame future
investment. Specific work items live in HLRs/LLRs as they are
adopted.

*   **Non-developer contribution.** Provide a standalone web form
    for stakeholders who will not install an editor extension or
    edit XML, sharing the JSON-RPC backend. Gated by sidecar
    stability and a real demand signal from a non-developer
    contributor.
*   **Editor breadth.** Bring the same in-editor authoring surfaces
    to JetBrains IDEs, Neovim, or a generic LSP-backed integration
    once the VS Code extension's UX has stabilised. Gated by
    demand from non-VS-Code users.
*   **Format breadth.** Optional renderers for additional output
    formats (HTML site, single-file PDF) when there is a concrete
    user request. Gated by demand; out of core scope until then.
*   **Schema evolution tooling.** Migrations and diff tooling for
    `schema_version` bumps so that long-lived projects can upgrade
    `Project.xml` without manual rewrites. Gated by the first
    breaking schema change.
*   **Delivery phasing (optional payload).** A thin, *optional*
    `<plan>` payload that groups existing HLRs into named phases or
    milestones (e.g. `<phase number="1" name="MVP"><includes
    ref="HLR-001"/>…</phase>`), rendered as a `Plan.md` with
    forward ("which HLRs land in Phase N?") and reverse ("which
    phase does HLR-X belong to?") tables computed by the existing
    trace-resolution machinery. This is **not** general project
    management — no tasks, owners, dates, or dependencies — and
    remains opt-in per project. Gated by a real user with a
    requirements-to-phasing question that GitHub Projects / Jira /
    a hand-written `PLAN.md` cannot answer.
*   **Self-contained extension distribution.** Today the VS Code
    extension assumes its host workspace already contains the
    TraceR `tools/` Python sidecar (`render_doc.py`,
    `lint_project.py`, `project_io.py`, `project.xsd`,
    `templates/`, `ai/`). For Marketplace-grade install the `.vsix`
    will ship a self-contained copy of those files inside the
    extension and the bootstrap flow will scaffold them into a new
    workspace's `tools/` so brand-new repositories are immediately
    usable from the CLI, from CI, and by contributors who do not
    have the extension installed. Pinned by HLR-060 / HLR-061 /
    HLR-062 and delivered in [SDP](SDP.md) Phase 6.

Anything not listed here is not on the roadmap and would require an
explicit vision update.

## 10. Relationship to the Rest of the Spec Stack

| Document | Question it answers |
| -------- | ------------------- |
| **PVD** (this document) | *Why* does this product exist, and how do we know it is succeeding? |
| [HLRs.md](HLRs.md) | *What* must the product do to deliver on the vision? |
| [LLRs.md](LLRs.md) | *How* does each function in the implementation contribute to an HLR? |
| [SDD.md](SDD.md) | *How is the implementation structured* to satisfy the LLRs? |
| [STP.md](STP.md) | *How do we verify* that each LLR (and therefore each HLR, and therefore the vision) is actually delivered? |
| [Traceability.md](Traceability.md) | *Where are the gaps*, end-to-end? |

A change to this PVD should propagate downward (some HLRs may be
added, retired, or reworded). A change discovered during
implementation that conflicts with this PVD is a signal to update
this document — not to silently diverge.
