---
description: "Use when: package the VS Code extension into a .vsix, create install package, build and package vsix"
tools: [execute, read, search, agent]
agents: [build]
---
You package the TraceR VS Code extension into a `.vsix` installer.

## Freshness check

Before building, determine whether the existing `.vsix` is stale:

1. `cd` to `tools/vscode-project-xml/`.
2. Look for `vscode-project-xml-*.vsix` in that directory.
3. If the `.vsix` exists, compare its mtime against the newest file under `src/` and `scripts/`, and also against `package.json`, `esbuild.config.js`, and every file under `../templates/`, `../project.xsd`, `../project_io.py`, `../render_doc.py`, `../lint_project.py`, `../project_edit.py`, and `../ai/` (the Python sidecar sources bundled by prepackage). Use a command like:
   ```
   find src/ scripts/ package.json esbuild.config.js \
        ../templates ../project.xsd ../project_io.py ../render_doc.py \
        ../lint_project.py ../project_edit.py ../ai \
        -newer vscode-project-xml-*.vsix -print -quit
   ```
4. If no file is newer, report that the `.vsix` is already up-to-date and stop.

## Build and package

If the `.vsix` is missing or stale:

1. Delegate to the **build** agent to compile the extension (`npm run build`).
2. Run `npm run package` which executes:
   - `npm run prepackage` — copies the Python sidecar tree into `dist/python/`
   - `vsce package` — bundles everything into `vscode-project-xml-<version>.vsix`
3. Report the full path to the produced `.vsix` and its size.
4. Provide install instructions:
   ```
   code --install-extension tools/vscode-project-xml/vscode-project-xml-<version>.vsix
   ```
   Then: **Ctrl+Shift+P** → **Developer: Reload Window**

## Constraints

- DO NOT modify source files.
- DO NOT publish to the marketplace.
- DO NOT run tests.
- The working directory for all npm commands is `tools/vscode-project-xml/`.
