// Phase 4 (HLR-005 / SDP §Phase 4): bootstrap a brand-new project
// from an empty workspace. Collects `name`, `short_name`, `author`
// via three QuickInput prompts, then asks the sidecar to run
// `render_doc.init_project` which writes a skeleton `Project.xml`
// and a populated `PVD.md` to the workspace's doc/ folder.
//
// Designed to work in an empty workspace: if no folder is open we
// surface a clear error and exit; we do NOT attempt to open a
// folder on the user's behalf (that's destructive and ambiguous).

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectIoClient } from '../sidecar';
import { getConfig } from '../util/paths';
import { SCAFFOLD_TOOLS_COMMAND } from './scaffoldTools';

const SHORT_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,15}$/;

/**
 * Run the init-project flow. Returns the final `Project.xml` URI on
 * success, or `undefined` if the user cancelled or the call failed.
 */
export async function initProject(
    sidecar: ProjectIoClient,
): Promise<vscode.Uri | undefined> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        void vscode.window.showErrorMessage(
            'Project Spec: open a folder before initialising a project.',
        );
        return undefined;
    }

    const name = await vscode.window.showInputBox({
        title: 'Project name',
        prompt: 'Human-readable project name (e.g. "Valgrind Parser")',
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim().length === 0 ? 'Name cannot be empty.' : undefined),
    });
    if (name === undefined) {
        return undefined;
    }

    const shortName = await vscode.window.showInputBox({
        title: 'Project short_name',
        prompt: 'Short identifier used in HLR-NNN / LLR-XXX-NN ids (lowercase letters, digits, _ or -; must start with a letter; ≤16 chars).',
        ignoreFocusOut: true,
        validateInput: (v) => (
            SHORT_NAME_PATTERN.test(v.trim())
                ? undefined
                : 'Must match /^[a-z][a-z0-9_-]{0,15}$/.'
        ),
    });
    if (shortName === undefined) {
        return undefined;
    }

    const author = await vscode.window.showInputBox({
        title: 'Project author',
        prompt: 'Author or team name (defaults to TBD).',
        value: 'TBD',
        ignoreFocusOut: true,
    });
    if (author === undefined) {
        return undefined;
    }

    const params = {
        name: name.trim(),
        short_name: shortName.trim(),
        author: author.trim() || 'TBD',
    };

    let result;
    try {
        result = await sidecar.initProject(params);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/exists/i.test(msg)) {
            const overwrite = await vscode.window.showWarningMessage(
                `${msg} Overwrite?`,
                { modal: true },
                'Overwrite',
            );
            if (overwrite !== 'Overwrite') {
                return undefined;
            }
            try {
                result = await sidecar.initProject({ ...params, force: true });
            } catch (err2) {
                void vscode.window.showErrorMessage(
                    `Project Spec: init_project failed: ${err2 instanceof Error ? err2.message : String(err2)}`,
                );
                return undefined;
            }
        } else {
            void vscode.window.showErrorMessage(
                `Project Spec: init_project failed: ${msg}`,
            );
            return undefined;
        }
    }

    // Open the new files side-by-side and refresh the tree.
    const xmlUri = vscode.Uri.file(path.isAbsolute(result.xml_path)
        ? result.xml_path
        : path.join(folder.uri.fsPath, result.xml_path));
    const pvdUri = vscode.Uri.file(path.isAbsolute(result.pvd_path)
        ? result.pvd_path
        : path.join(folder.uri.fsPath, result.pvd_path));

    await vscode.commands.executeCommand('vscode.open', xmlUri);
    await vscode.commands.executeCommand('markdown.showPreviewToSide', pvdUri);
    await vscode.commands.executeCommand('projectXml.refresh');

    // Phase 6 (LLR-PKG-05, HLR-061): if the new workspace lacks a
    // tools/ directory, drop the bundled copy in so the CLI, CI, and
    // contributors without the extension installed all work
    // immediately. The user already opted into bootstrap, so we
    // overwrite without re-prompting (the dir didn't exist anyway).
    const toolsRel = getConfig().get<string>('toolsDir') ?? 'tools';
    const toolsAbs = path.isAbsolute(toolsRel)
        ? toolsRel
        : path.join(folder.uri.fsPath, toolsRel);
    if (!fs.existsSync(toolsAbs)) {
        try {
            await vscode.commands.executeCommand(SCAFFOLD_TOOLS_COMMAND, {
                overwrite: true,
                silent: true,
            });
        } catch (err) {
            // Non-fatal — bootstrap succeeded; surface as info, not error.
            const msg = err instanceof Error ? err.message : String(err);
            void vscode.window.showWarningMessage(
                `Project Spec: initialised the project, but scaffolding tools/ failed: ${msg}. ` +
                'You can re-run "Project Spec: Scaffold tools/ into workspace…" later.',
            );
        }
    }

    void vscode.window.showInformationMessage(
        `Project Spec: initialised ${path.basename(result.xml_path)} and ${path.basename(result.pvd_path)}.`,
    );
    return xmlUri;
}
