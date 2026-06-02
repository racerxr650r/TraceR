---
name: project-xml
description: "Use when editing, regenerating, interpreting, or verifying any of the project's spec documents (PVD, SDD, HLRs, LLRs, Test Plan, Traceability) or their generator inputs. doc/Project.xml is the SINGLE SOURCE OF TRUTH for the project's design, requirements, and verification — and the canonical store from which traceability (SDD→HLR→LLR→Test) is measured. doc/PVD.md is the hand-authored Product Vision Document that sits above the generated stack; the AI is expected to draft and fill in PVD content under the developer's direction, asking targeted questions when sections are thin or missing. USE FOR: any change to doc/PVD.md, doc/Project.xml, doc/SDD.md, doc/HLRs.md, doc/LLRs.md, doc/STP.md, doc/Traceability.md; drafting or revising the Product Vision Document; adding/removing/renumbering HLRs or LLRs; adding new tests under test/ that need traceability annotations; updating Project.xml schema; authoring new Jinja2 templates under tools/templates/; running tools/render_doc.py; verifying those spec edits with lint/render/tests. DO NOT USE FOR: edits to source code under src/ that do not change a documented behaviour, design element, or requirement; routine build/test/coverage work unrelated to a spec/doc change; non-doc tooling under tools/ that is unrelated to render_doc.py."
---

# Project.xml — Source of Truth for Design, Requirements, and Traceability

## Role

`doc/Project.xml` is the **single source of truth** for this project's
specification, design, and verification artefacts. It serves two
purposes:

1.  **Documenting the project.** The four spec markdown documents are
    *generated* from `Project.xml` by Jinja2 templates in
    [tools/templates/](../../../tools/templates/) via
    [tools/render_doc.py](../../../tools/render_doc.py). Editing the
    generated `.md` files directly is incorrect — changes will be
    overwritten on the next render.
2.  **Measuring traceability.** Every `<hlr>`, `<llr>`, and `<test>`
    element carries a `<traces>` block linking it upstream. The
    SDD→HLR→LLR→Test relations are computed from those blocks, and
    coverage gaps are reported in
    [doc/Traceability.md](../../../doc/Traceability.md).

The canonical schema reference for humans is
[tools/Developers_Guide.md](../../../tools/Developers_Guide.md).
**Read that file before performing any non-trivial edit to
`Project.xml` or any of its templates.**

> **Keep `Developers_Guide.md` in sync.** Any change to
> [tools/project.xsd](../../../tools/project.xsd) (new element,
> renamed attribute, changed cardinality, tightened restriction,
> bumped `schema_version`) **or** to how
> [tools/render_doc.py](../../../tools/render_doc.py) parses
> `Project.xml` and exposes data on the `project.*` namespace
> consumed by templates (new `build_*` function, new index, new
> filter, changed field name) **must be reflected in
> [tools/Developers_Guide.md](../../../tools/Developers_Guide.md)
> in the same change.** The schema reference is the contract
> between the data, the renderer, and template authors; if it
> drifts, future edits made against it will silently produce
> invalid XML or broken renders. After updating, re-render every
> document and run `tools/lint_project.py` to confirm.

Sitting **above** the generated stack is the hand-authored
[doc/PVD.md](../../../doc/PVD.md) — see [Product Vision
Document](#product-vision-document-pvd) below.

## Product Vision Document (PVD)

[doc/PVD.md](../../../doc/PVD.md) is the **Product Vision Document**.
Unlike the SDD/HLRs/LLRs/STP/Traceability documents, the PVD is
**hand-authored** — it is *not* generated from `Project.xml` and has
no template under `tools/templates/`. It defines *why* the product
exists, *who* it is for, and *how success is measured*, and the rest
of the specification stack must remain aligned with it.

### AI Role for the PVD

The **developer is the author** of the PVD. The **AI is the
ghostwriter**: the AI is expected to draft, expand, and revise the
actual prose of the document under the developer's direction. The
developer supplies intent, constraints, and approval; the AI supplies
the words.

When asked to work on the PVD:

1.  **Read [doc/PVD.md](../../../doc/PVD.md) first** to see what
    sections already exist and how complete each one is.
2.  **Identify thin or missing sections.** A section is "thin" if it
    is a placeholder, a single sentence where the structure expects a
    paragraph, a TODO marker, or a list with one item where multiple
    are expected.
3.  **Ask the developer targeted questions** to elicit the missing
    content before drafting it. Prefer a small number of specific,
    answerable questions over open-ended prompts. Examples (templates
    — substitute the actual section/field names from this project):
    *   "Section *<N>* (*<Section Title>*) currently lists only
        *<single item>*. Should I add other *<category>* entries, or
        is the list intentionally minimal?"
    *   "Section *<N>* (*<Section Title>*) has no *<metric / field /
        criterion>* for *<topic>*. Do you want a target value, or
        should I leave it out?"
    *   "Section *<N>* (*<Section Title>*) mentions *<broad theme>*
        — should I name a specific *<technology / standard /
        deliverable>* explicitly?"
4.  **Draft the content** once the developer has answered. Match the
    existing tone, heading depth, and table style of
    [doc/PVD.md](../../../doc/PVD.md). Keep the AI's additions
    consistent with the project facts already documented in
    [doc/SDD.md](../../../doc/SDD.md) and [README.md](../../../README.md).
5.  **Do not invent product direction.** If a question is genuinely
    open (scope, target users, success metrics, roadmap), ask — do
    not guess. The AI fills in *content*; the developer decides
    *direction*.

### Expected PVD Sections

The PVD should normally contain, in roughly this order:

*   Vision Statement
*   Problem Statement
*   Target Users (with personas)
*   Value Proposition
*   Product Principles (the tie-breakers when requirements conflict)
*   Scope (in scope / out of scope / non-goals)
*   Success Metrics
*   Roadmap Themes
*   Relationship to the rest of the spec stack
    (PVD → HLRs → LLRs → SDD → STP → Traceability)

If any of these are absent or underspecified, that is the AI's cue
to ask a clarifying question and then draft the section.

### What the PVD Is *Not*

*   It is **not** a requirements document — keep specific requirements
    in [doc/HLRs.md](../../../doc/HLRs.md) (via `Project.xml`).
*   It is **not** a design document — keep architecture and modules
    in [doc/SDD.md](../../../doc/SDD.md) (via `Project.xml`).
*   It is **not** a release plan — keep dated commitments out; the
    *Roadmap Themes* section names directions, not delivery dates.

## Generated Documents

| Generated file | Source | Template |
| -------------- | ------ | -------- |
| [doc/SDD.md](../../../doc/SDD.md) | `<sdd>` payload + `<metadata id="SDD">` | `tools/templates/SDD.md.j2` |
| [doc/HLRs.md](../../../doc/HLRs.md) | `<hlrs>` + `<metadata id="HLRs">` | `tools/templates/HLRs.md.j2` |
| [doc/LLRs.md](../../../doc/LLRs.md) | `<llrs>` + `<metadata id="LLRs">` | `tools/templates/LLRs.md.j2` |
| [doc/STP.md](../../../doc/STP.md) | `<stp>` + `<tests>` + `<llrs>` + `<metadata id="STP">` | `tools/templates/STP.md.j2` |
| [doc/Traceability.md](../../../doc/Traceability.md) | All `<traces>` + `<metadata id="Traceability">` | `tools/templates/Traceability.md.j2` |

Every generated document must have a corresponding
`<metadata><document id="..."/></metadata>` entry — the renderer
looks the document up by the second positional CLI argument.

## Decision Flow

| User intent | Action |
| ----------- | ------ |
| "Update the SDD section about X" | Edit the matching node inside `<sdd>` in `Project.xml`, then regenerate `doc/SDD.md`. |
| "Add an HLR" | Append a new `<hlr id="HLR-NNN" name="...">` inside the appropriate `<hlrs>/<section>`; add `<traces target="SDD" ref="...">` for every SDD section it implements. Regenerate `HLRs.md` and `Traceability.md`. |
| "Add an LLR" | Append a new `<llr id="LLR-XXX-NN">` inside the matching `<llrs>/<function>`; add `<traces target="HLR" ref="HLR-NNN" name="...">` for every HLR it implements. Regenerate `LLRs.md` and `Traceability.md`. |
| "Add a test" | Add the `static void test_*(void **state)` under `test/` *with a doc-comment block citing `LLR-XXX-NN` and/or `HLR-NNN`*. Then add a matching `<test name="...">` (with `<purpose>` and `<traces>`) inside the appropriate `<tests>/<file>`. Regenerate `STP.md` and `Traceability.md`. |
| "Why is HLR-NNN / LLR-XXX-NN listed as having no test?" | It has no `<test>` whose `<traces>` cite it. Either add a test, or document the gap in `Traceability.md §6.x` (the renderer does this from the data). |
| "Add a new field to a section that doesn't exist yet" | First update [tools/project.xsd](../../../tools/project.xsd) (and bump `schema_version`), then update [tools/Developers_Guide.md](../../../tools/Developers_Guide.md) so the human-facing reference matches, then `Project.xml`, then the relevant template under `tools/templates/` (and `tools/render_doc.py` if a new `build_*` is needed), then regenerate. |
| "Change how a payload element is parsed/exposed to templates" | Update [tools/render_doc.py](../../../tools/render_doc.py), then update the *Renderer Data Surface* section of [tools/Developers_Guide.md](../../../tools/Developers_Guide.md) so template authors see the new field/index/filter, then update any affected templates. |

## Hard Rules

*   **Never edit `doc/SDD.md`, `doc/HLRs.md`, `doc/LLRs.md`,
    `doc/STP.md`, or `doc/Traceability.md` by hand.** They are
    generated. Edit `Project.xml` (and/or the relevant template),
    then run the renderer.
*   **Never put section numbers or H2/H3 headings inside the `<sdd>`
    or `<stp>` payloads.** All scaffolding (H1 title, version block,
    section numbering, table headers) lives in the templates. Payload
    elements carry content only.
*   **HLR/LLR/test anchors are emitted by the templates.** HLRs.md,
    LLRs.md, and STP.md each emit `<a id="..."></a>` immediately
    before the bullet/row for every `HLR-NNN`, `LLR-XXX-NN`, and
    `test_*` name. The Traceability template links to those anchors;
    do not remove them when editing the templates.
*   **`HLR-NNN` and `LLR-XXX-NN` IDs are stable contracts.** Do not
    renumber existing IDs. Allocate the next free number when adding.
*   **Every `<hlr>` should have at least one `<trace target="SDD">`.**
    Every `<llr>` should have at least one `<trace target="HLR">`.
    Every `<test>` should have at least one `<trace target="LLR">` or
    `<trace target="HLR">`. Missing traces produce coverage-gap rows.
*   **Wrap any body containing backticks, angle brackets, ampersands,
    or `[markdown links]` in `<![CDATA[...]]>`.** Bare markdown bodies
    will silently corrupt the XML when they contain `<` or `&`.
*   **Bump `<project schema_version="...">`** whenever you change the
    structure of `Project.xml` in a way that existing templates or
    `tools/render_doc.py` could not consume unchanged.
*   **Any change to `tools/project.xsd` requires a matching update
    to [tools/Developers_Guide.md](../../../tools/Developers_Guide.md)
    in the same commit.** This applies to every kind of XSD edit:
    new / removed / renamed elements or attributes, changed
    cardinality, tightened or loosened restrictions, new
    `<xs:appinfo>` UI-hint vocabulary, schema_version bumps. The
    schema reference is the human-facing contract; if it drifts
    from the XSD, downstream edits made against the reference
    will silently produce invalid XML. (See also the callout at
    the top of this file.)
*   **Update [README.md](../../../README.md) before pushing any
    commit that changes user-visible status or functionality.**
    The README's *Status* table (which phase / sub-phase is
    delivered vs. in flight) and *VS Code extension* / *CLI
    tooling* feature lists are the project's public face. Whenever
    a phase or slice ships a new surface (a new tree node, a new
    command, a new setting, a new `Finding.code`, a new schema-
    version bump, a phase status change), refresh the README in
    the same branch and verify the doc-link section still points
    at the right files. README cleanup is a precondition for
    `git push`, not a follow-up.

## Schema and Renderer Data Surface

All schema details — every element, every attribute, cardinality
rules, child-order constraints, the full XML skeleton, and the
`project.*` namespace exposed by
[tools/render_doc.py](../../../tools/render_doc.py) to templates —
live in [tools/Developers_Guide.md](../../../tools/Developers_Guide.md).
Consult that document before authoring or modifying any
`<sdd>`/`<stp>`/`<hlrs>`/`<llrs>`/`<tests>` content, before writing
a new template, or before changing how the renderer parses a
payload.

Do **not** duplicate schema fragments into this file: keeping them
here risks silent drift from the canonical reference.

## Regeneration

After any edit to `Project.xml` or a template:

```bash
python3 tools/render_doc.py tools/templates/SDD.md.j2          SDD          --out doc/SDD.md
python3 tools/render_doc.py tools/templates/HLRs.md.j2         HLRs         --out doc/HLRs.md
python3 tools/render_doc.py tools/templates/LLRs.md.j2         LLRs         --out doc/LLRs.md
python3 tools/render_doc.py tools/templates/STP.md.j2          STP          --out doc/STP.md
python3 tools/render_doc.py tools/templates/Traceability.md.j2 Traceability --out doc/Traceability.md
```

Validate the XML before regenerating:

```bash
python3 -c "import xml.etree.ElementTree as ET; ET.parse('doc/Project.xml')"
```

## Verification Environment (Required)

When verifying spec/document edits made under this skill, always use the
repository's existing virtual environment first and avoid installing
tooling unless strictly necessary.

1. **Prefer the existing repo venv** at `.venv/bin/python` for lint,
    render, and Python tests.
2. **Do not install into system Python** (PEP 668 / externally-managed
    environments). Avoid `pip install --user` or global package installs.
3. **Do not create or recreate `.venv` if it already exists.**
4. **Only install missing packages when verification is blocked and needed
    for the current task**, and only inside the existing `.venv`.
5. **Before any install attempt, check what is already present**:

```bash
.venv/bin/python -m pip show defusedxml jinja2 lxml
```

Recommended verification commands for this project:

```bash
.venv/bin/python tools/lint_project.py

.venv/bin/python tools/render_doc.py tools/templates/SDD.md.j2          SDD          --out doc/SDD.md
.venv/bin/python tools/render_doc.py tools/templates/HLRs.md.j2         HLRs         --out doc/HLRs.md
.venv/bin/python tools/render_doc.py tools/templates/LLRs.md.j2         LLRs         --out doc/LLRs.md
.venv/bin/python tools/render_doc.py tools/templates/STP.md.j2          STP          --out doc/STP.md
.venv/bin/python tools/render_doc.py tools/templates/Traceability.md.j2 Traceability --out doc/Traceability.md
```

## Build, Test, and Package via Makefile

[tools/Makefile](../../../tools/Makefile) is the single entry point
for building, testing, and packaging. **Always use its targets
instead of running npm/python commands directly.** Run
`make -C tools help` to see all available targets.

Key targets:

| Task | Command |
| ---- | ------- |
| Build the VS Code extension | `make -C tools ext-build` |
| Package a `.vsix` | `make -C tools ext-package` |
| Run Python tests only | `make -C tools test-py` |
| Run extension unit tests only | `make -C tools ext-test-unit` |
| Run extension UI tests only | `make -C tools ext-test-ui` |
| Run **all** tests | `make -C tools test` |
| Full CI check (lint + render + test + build) | `make -C tools ci` |

The shape of the `project` namespace passed to every template —
payload roots, flat lists, ID lookups, cross-reference indexes,
coverage-gap lists, and available filters — is documented in the
*Renderer Data Surface* section of
[tools/Developers_Guide.md](../../../tools/Developers_Guide.md). Use
those prebuilt structures rather than recomputing relations in
Jinja, and update that section whenever you add a new `build_*`
function or index in [tools/render_doc.py](../../../tools/render_doc.py).

## Common Pitfalls

*   **Editing the generated `.md` instead of `Project.xml`.** Always
    grep for the prose you're about to change inside `Project.xml`
    first — if it's there, the `.md` is generated.
*   **Adding a test without a doc-comment trace block.** The test will
    not appear in `STP.md` / `Traceability.md` until a matching
    `<test>` entry is added to `Project.xml`. Both must be updated.
*   **Forgetting the `<traces>` block.** A new HLR/LLR/test with no
    traces becomes an immediate coverage gap.
*   **Putting `##` headings inside `<sdd>` bodies.** The template emits
    its own headings; duplicate or mis-numbered output is the symptom.
*   **Unescaped `<`/`&`/backticks in a body.** Wrap in `<![CDATA[...]]>`.
*   **Stale `<count>` values in `<metadata>/<counts>`.** They are
    informational; the canonical counts come from counting child
    elements at render time. Update them when convenient but do not
    rely on them.
