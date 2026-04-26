#!/usr/bin/env node
// Phase 6 (LLR-PKG-01, LLR-PKG-06): bundle every Python file the
// extension's sidecar spawns into `dist/python/` so the shipped
// `.vsix` is fully self-contained (HLR-060).
//
// Copies (recursively) from the canonical TraceR `tools/` source
// tree into `tools/vscode-project-xml/dist/python/`:
//   - project_io.py, render_doc.py, lint_project.py, project_edit.py,
//     project_merge.py, project.xsd
//   - templates/   (Jinja2 templates the renderer reads)
//   - ai/          (sidecar AI pipeline package, when present)
//   - User_Manual.md, Developers_Guide.md  (Phase 7 — bundled docs)
//
// Wipes any pre-existing `dist/python/` first so each package build
// starts from a clean copy. Writes the source XSD's `version`
// attribute (the Project.xml `schema_version` baseline the bundled
// XSD accepts) into `dist/python/.bundle_version` for the activation
// freshness check (LLR-PKG-07).

'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;                                          // tools/vscode-project-xml/scripts
const EXT_ROOT = path.resolve(HERE, '..');                       // tools/vscode-project-xml
const TOOLS_SRC = path.resolve(EXT_ROOT, '..');                  // tools
const DIST = path.join(EXT_ROOT, 'dist', 'python');

const PYTHON_FILES = [
    'project_io.py',
    'render_doc.py',
    'lint_project.py',
    'project_edit.py',
    'project_merge.py',
    'project.xsd',
];
const PYTHON_DIRS = [
    'templates',
    'ai',
];
// Phase 7 (LLR-PKG-08): ship the user-facing documentation alongside
// the Python toolchain so the Walkthrough's "Open the User Manual"
// and "Open the Developer's Guide" steps work in any installed
// extension, even without a workspace checkout.
const DOC_FILES = [
    'User_Manual.md',
    'Developers_Guide.md',
];

/** Recursively remove a directory if it exists. */
function rmrf(target) {
    if (!fs.existsSync(target)) {
        return;
    }
    fs.rmSync(target, { recursive: true, force: true });
}

/** Recursively copy a directory, skipping __pycache__ and *.pyc. */
function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) {
            continue;
        }
        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, dstPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, dstPath);
        }
    }
}

/** Read the bundled XSD's `version` attribute on the root xs:schema element. */
function readSchemaVersion(xsdPath) {
    const text = fs.readFileSync(xsdPath, 'utf8');
    // The XSD root element is `<xs:schema ... version="X.Y">`. We do
    // a regex pick rather than full XML parsing — the file is
    // controlled by this repo and the attribute placement is stable.
    const match = text.match(/<xs:schema\b[^>]*\sversion\s*=\s*"([^"]+)"/);
    if (!match) {
        throw new Error(
            `prepackage: could not find xs:schema/@version in ${xsdPath}; ` +
            'add a version="X.Y" attribute on the <xs:schema> root.',
        );
    }
    return match[1];
}

function main() {
    rmrf(DIST);
    fs.mkdirSync(DIST, { recursive: true });

    for (const name of PYTHON_FILES) {
        const src = path.join(TOOLS_SRC, name);
        if (!fs.existsSync(src)) {
            throw new Error(`prepackage: missing required source file ${src}`);
        }
        fs.copyFileSync(src, path.join(DIST, name));
    }

    for (const name of PYTHON_DIRS) {
        const src = path.join(TOOLS_SRC, name);
        if (!fs.existsSync(src)) {
            // ai/ may legitimately not exist in early phases; skip.
            continue;
        }
        copyDir(src, path.join(DIST, name));
    }

    for (const name of DOC_FILES) {
        const src = path.join(TOOLS_SRC, name);
        if (!fs.existsSync(src)) {
            throw new Error(`prepackage: missing required doc file ${src}`);
        }
        fs.copyFileSync(src, path.join(DIST, name));
    }

    const version = readSchemaVersion(path.join(DIST, 'project.xsd'));
    fs.writeFileSync(path.join(DIST, '.bundle_version'), `${version}\n`, 'utf8');

    process.stdout.write(
        `prepackage: wrote ${DIST} (schema_version=${version})\n`,
    );
}

main();
