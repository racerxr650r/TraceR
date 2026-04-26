# Marketplace assets

This directory holds the static assets shipped with the extension's
`.vsix` and surfaced on the Marketplace listing.

## Required assets

| File | Spec | Notes |
| --- | --- | --- |
| `icon.svg` | activity-bar icon | already authored; referenced by `viewsContainers` and `views` in `package.json` |
| `icon.png` | 128×128 Marketplace icon | required by `vsce package` for the listing tile; referenced from `package.json` `"icon"` field |
| `screenshots/tree.png` | tree-view screenshot | listing screenshot — Project Spec activity-bar tree populated |
| `screenshots/form.png` | form panel screenshot | listing screenshot — schema-driven form for an HLR |
| `screenshots/preview.png` | render preview screenshot | listing screenshot — side-by-side Markdown preview of HLRs.md |
| `walkthrough.gif` | end-to-end walkthrough | optional GIF embedded in the README's "Get started" section |

`walkthrough/*.md` (already present) are the per-step Markdown
files referenced by the `walkthroughs` contribution in
`package.json`.

## How to capture / refresh

1. Build the extension (`npm run prepackage && npm run build`) and
   load it in VS Code via "Extensions: Install from VSIX…".
2. Open a TraceR-shaped workspace (the dogfood checkout works).
3. Capture each surface at 1920×1080 (or 2× for HiDPI) and crop to
   the relevant panel before committing.
4. Re-export `icon.svg` to `icon.png` at exactly 128×128 (e.g.
   `inkscape -w 128 -h 128 icon.svg -o icon.png`).

## Why these aren't generated

The Marketplace listing sells the extension to humans; auto-
generated screenshots from a clean fixture rarely look as good as
a real session's. The placeholder columns in this README exist so a
future contributor (or a release script) knows exactly what files
to drop in before running `vsce publish`.
