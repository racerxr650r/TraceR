# Initialise Project.xml

The first step of a TraceR project is a `Project.xml` — the single
source of truth for everything the doc generator and lint rules
consume.

Run **Project Spec: Initialise Project.xml…** from the Command
Palette, or use the link in the walkthrough step. You'll be asked
for:

- A **project name** (any string, e.g. *Valgrind Parser*).
- A **short_name** — the lowercase identifier embedded in
  `HLR-NNN` and `LLR-XXX-NN` ids. Must match
  `^[a-z][a-z0-9_-]{0,15}$`.
- An **author** — defaults to `TBD`.

The skeleton lands at `doc/Project.xml`; a populated `doc/PVD.md`
is opened side-by-side for editing.
