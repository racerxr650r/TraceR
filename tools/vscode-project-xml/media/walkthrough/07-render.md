# Render All Spec Docs

Once lint is green, **Project Spec: Render All** runs every
discovered `<metadata><document>` in one pass. Out of the box that
means PVD, SDD, HLRs, LLRs, STP, Traceability — but the renderer
is data-driven: any `<document>` you add to `Project.xml` becomes
an addressable target on the next refresh.

The rendered files live alongside `doc/Project.xml` and are safe
to commit; CI re-renders on every push to verify they're up to
date.
