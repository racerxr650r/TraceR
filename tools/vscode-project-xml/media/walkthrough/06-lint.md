# Lint

Run **Project Spec: Lint** to validate the XML against
`tools/project.xsd` and the structural lint rules in
`tools/lint_project.py`.

Findings appear in the Problems panel. Quick-Fix actions are
attached to the common ones (broken trace refs, malformed ids,
missing templates, untested LLRs).

Lint is the prerequisite for render: green lint means the
generated docs will compile against the same schema CI uses.
