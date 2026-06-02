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
const { spawnSync } = require('child_process');

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
// Screenshots referenced by the User Manual via relative paths
// (../images/screenshots/*.png).  Placed under dist/images/ so the
// relative path from dist/python/User_Manual.md resolves correctly.
const REPO_ROOT = path.resolve(TOOLS_SRC, '..');                 // project root
const SCREENSHOTS_SRC = path.join(REPO_ROOT, 'images', 'screenshots');
const SCREENSHOTS_DST_REL = path.join('..', 'images', 'screenshots');  // relative to DIST

// Generic prompts and agents installable into any project that uses TraceR.
// TraceR-internal agents (TracerDevelop, build, package) are intentionally
// excluded — they are only meaningful inside this repository.
const GITHUB_SRC = path.join(REPO_ROOT, '.github');
const DIST_GITHUB = path.join(EXT_ROOT, 'dist', 'github');
const GENERIC_PROMPTS = [
    'PR.prompt.md',
    'PrepRelease.prompt.md',
    'Release.prompt.md',
    'UpdateDocs.prompt.md',
];
const GENERIC_AGENTS = [
    'ci.agent.md',
    'makefile.agent.md',
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

/**
 * Install required Python packages into `dist/python/` so the sidecar works
 * without any additional setup in the user's workspace.  Packages land in the
 * same directory as `project_io.py`, which Python adds to `sys.path` when it
 * runs the script, so they are found automatically.
 */
function installPythonDeps(dist) {
    // Prefer the workspace venv Python if present (matches the TraceR dev env).
    const candidates = [];
    const venvPython = path.resolve(REPO_ROOT, '.venv', 'bin', 'python');
    if (fs.existsSync(venvPython)) {
        candidates.push(venvPython);
    }
    candidates.push('python3', 'python');

    const packages = ['defusedxml', 'jinja2', 'lxml'];

    for (const py of candidates) {
        const result = spawnSync(py, [
            '-m', 'pip', 'install', '--quiet',
            '--target', dist,
            ...packages,
        ], { encoding: 'utf8' });

        if (result.error) {
            if (result.error.code === 'ENOENT') {
                continue;  // this candidate doesn't exist; try the next one
            }
            throw new Error(`prepackage: pip install error: ${result.error.message}`);
        }
        if (result.status !== 0) {
            throw new Error(
                `prepackage: pip install failed (status=${result.status}):\n${result.stderr}`,
            );
        }
        process.stdout.write(`prepackage: installed Python deps via ${py}\n`);
        return;
    }
    throw new Error(
        'prepackage: could not find python3 or python to install dependencies. ' +
        'Ensure Python is on your PATH.',
    );
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

    // Copy screenshots so the User Manual's relative image paths work
    // inside the bundled extension.
    if (fs.existsSync(SCREENSHOTS_SRC)) {
        const dst = path.resolve(DIST, SCREENSHOTS_DST_REL);
        copyDir(SCREENSHOTS_SRC, dst);
    }

    // Install third-party Python packages into dist/python/ so the sidecar
    // starts successfully in any workspace, not just the TraceR dev env.
    installPythonDeps(DIST);

    // Copy generic prompts and agents into dist/github/ so initProject can
    // install them into new workspaces without needing the source repo.
    const distPrompts = path.join(DIST_GITHUB, 'prompts');
    const distAgents  = path.join(DIST_GITHUB, 'agents');
    fs.mkdirSync(distPrompts, { recursive: true });
    fs.mkdirSync(distAgents,  { recursive: true });
    for (const name of GENERIC_PROMPTS) {
        const src = path.join(GITHUB_SRC, 'prompts', name);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(distPrompts, name));
        }
    }
    for (const name of GENERIC_AGENTS) {
        const src = path.join(GITHUB_SRC, 'agents', name);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(distAgents, name));
        }
    }
    process.stdout.write(
        `prepackage: copied ${GENERIC_PROMPTS.length} prompts and ` +
        `${GENERIC_AGENTS.length} agents into dist/github/\n`,
    );

    const version = readSchemaVersion(path.join(DIST, 'project.xsd'));
    fs.writeFileSync(path.join(DIST, '.bundle_version'), `${version}\n`, 'utf8');

    process.stdout.write(
        `prepackage: wrote ${DIST} (schema_version=${version})\n`,
    );
}

main();
