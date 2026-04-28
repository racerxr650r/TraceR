---
description: "Use when: build the VS Code extension, compile TypeScript, run esbuild, bundle extension.js or formPanel.js"
tools: [execute, read, search]
---
You build the TraceR VS Code extension located at `tools/vscode-project-xml/`.

## Build steps

1. `cd` to `tools/vscode-project-xml/`
2. If `node_modules/` is missing or `package.json` is newer than `node_modules/.package-lock.json`, run `npm install`.
3. Run `npm run build` which invokes `node esbuild.config.js` and produces:
   - `dist/extension.js` — Node/CJS extension host bundle
   - `dist/formPanel.js` — browser/IIFE webview bundle
4. Report success or failure with the esbuild output.

## Constraints

- DO NOT run `npm run package` or `vsce package` — that is the package agent's job.
- DO NOT modify source files.
- DO NOT run tests — that is a separate task.
- The working directory for all npm commands is `tools/vscode-project-xml/`.
