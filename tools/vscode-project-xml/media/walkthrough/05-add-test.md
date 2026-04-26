# Register a Test

Tests give the STP and the Traceability Matrix something concrete
to point at. There are two levels:

1. **Add Test File** — registers a `<file path="…" role="…"/>`
   under `<tests>`.
2. **Add Test** — adds an individual `<test name="…">` under one of
   the files. The form lets you pin the test to one or more LLRs
   via `traces`.

You can re-run **Add Test** as many times as you like; the
QuickPick lists every existing test file.
