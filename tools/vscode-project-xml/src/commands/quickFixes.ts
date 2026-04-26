// Phase 2.5c — command bodies for the four Quick Fixes.
//
// Each command is invoked from a CodeAction registered by
// QuickFixProvider. It receives `{ uri, message, range }` describing
// the diagnostic the user clicked, parses the message with the pure
// helpers in fixes.ts, and applies the resulting WorkspaceEdit. The
// commands are payload-agnostic (they consult the parsed tree via the
// sidecar but never branch on payload element name).

import * as vscode from 'vscode';
import { ProjectIoClient, ParsedProject } from '../sidecar';
import { getProjectXmlPath } from '../util/paths';
import {
    nextFreeHlrId,
    nextFreeLlrId,
    parseBrokenTrace,
    parseIdFormat,
    parseMissingTemplate,
    parseNoTest,
    templateStubContent,
} from '../codeActions/fixes';
import * as path from 'path';

interface FixArgs {
    uri: string;
    message: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
}

function asRange(args: FixArgs): vscode.Range {
    return new vscode.Range(
        new vscode.Position(args.range.start.line, args.range.start.character),
        new vscode.Position(args.range.end.line, args.range.end.character),
    );
}

function asUri(args: FixArgs): vscode.Uri {
    return vscode.Uri.parse(args.uri);
}

// ---------------------------------------------------------------------
// broken-trace — pick an id from the parsed tree and rewrite the
// diagnostic range with it.
// ---------------------------------------------------------------------

export async function fixBrokenTrace(
    sidecar: ProjectIoClient,
    args: FixArgs,
): Promise<void> {
    const info = parseBrokenTrace(args.message);
    if (!info) {
        return;
    }
    const project = await loadParsed(sidecar);
    const candidates = collectIdsForTarget(project, info.target);
    if (candidates.length === 0) {
        await vscode.window.showWarningMessage(
            `Project Spec: no ${info.target} ids defined in the parsed tree.`,
        );
        return;
    }
    const picked = await vscode.window.showQuickPick(candidates, {
        title: `Replace broken ${info.target} ref "${info.badRef}" with…`,
        placeHolder: `Pick a ${info.target} id`,
    });
    if (!picked) {
        return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(asUri(args), asRange(args), picked);
    await vscode.workspace.applyEdit(edit);
}

// ---------------------------------------------------------------------
// id-format — allocate the next free id and replace the bad value.
// ---------------------------------------------------------------------

export async function fixIdFormat(
    sidecar: ProjectIoClient,
    args: FixArgs,
): Promise<void> {
    const info = parseIdFormat(args.message);
    if (!info) {
        return;
    }
    const project = await loadParsed(sidecar);
    const newId = info.kind === 'HLR'
        ? nextFreeHlrId(collectIdsForTarget(project, 'HLR'))
        : nextFreeLlrId(info.prefix ?? 'GEN', collectIdsForTarget(project, 'LLR'));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(asUri(args), asRange(args), newId);
    await vscode.workspace.applyEdit(edit);
}

// ---------------------------------------------------------------------
// missing-template — create the missing .j2 file with stub contents.
// ---------------------------------------------------------------------

export async function fixMissingTemplate(args: FixArgs): Promise<void> {
    const info = parseMissingTemplate(args.message);
    if (!info) {
        return;
    }
    const target = resolveWorkspacePath(info.templatePath);
    if (!target) {
        await vscode.window.showWarningMessage(
            'Project Spec: cannot resolve workspace root for template stub.',
        );
        return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(target, { ignoreIfExists: true });
    edit.insert(target, new vscode.Position(0, 0), templateStubContent(info.docId));
    await vscode.workspace.applyEdit(edit);
}

// ---------------------------------------------------------------------
// no-test — append a `<file><test/></file>` block to <tests>.
//
// Phase 3: this is the structural Quick Fix in the table — it adds a
// new <test> element rather than rewriting flat text. We route it
// through ProjectIoClient.applyEdit() so the new element passes
// through the XSD + linter validation gate before the file is
// rewritten (HLR-018, HLR-019). The other three fixes
// (broken-trace, id-format, missing-template) stay on WorkspaceEdit
// because they only mutate flat text and are usable on dirty buffers.
// ---------------------------------------------------------------------

export async function fixNoTest(
    sidecar: ProjectIoClient,
    args: FixArgs,
): Promise<void> {
    const info = parseNoTest(args.message);
    if (!info) {
        return;
    }
    // Honour the dirty-buffer prompt (HLR-018 — never write through stale state).
    const xmlPath = getProjectXmlPath();
    if (xmlPath) {
        const open = vscode.workspace.textDocuments.find(
            (d) => d.uri.fsPath === xmlPath && d.isDirty,
        );
        if (open) {
            const choice = await vscode.window.showWarningMessage(
                'Project.xml has unsaved changes in the editor. Save before applying the fix?',
                { modal: true },
                'Save and Continue',
                'Cancel',
            );
            if (choice !== 'Save and Continue') {
                return;
            }
            await open.save();
        }
    }

    const testName = `test_${info.targetId.toLowerCase().replace(/-/g, '_')}_smoke`;
    const filePath = `test/test_${info.targetId.toLowerCase().replace(/-/g, '_')}.py`;
    try {
        const result = await sidecar.applyEdit({
            operations: [{
                op: 'add',
                path: '/tests/file/-',
                value: {
                    '@path': filePath,
                    test: {
                        '@name': testName,
                        purpose: `Cover ${info.target} ${info.targetId}.`,
                        traces: {
                            trace: [{ '@target': info.target, '@ref': info.targetId }],
                        },
                    },
                },
            }],
        });
        if (!result.written) {
            const errs = (result.findings.errors ?? []).join('\n') ||
                'unknown validation failure';
            void vscode.window.showWarningMessage(
                `Project Spec: stub test was rejected by the validator and the file was not changed.\n${errs}`,
            );
            return;
        }
        // Refresh tree + diagnostics so the user sees the new test
        // entry and the lint warning clears.
        await vscode.commands.executeCommand('projectXml.refresh');
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(
            `Project Spec: apply_edit failed: ${message}`,
        );
    }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

async function loadParsed(sidecar: ProjectIoClient): Promise<ParsedProject> {
    const xmlPath = getProjectXmlPath();
    const params = xmlPath ? { xml_path: xmlPath } : {};
    return sidecar.parseToJson(params);
}

function collectIdsForTarget(
    project: ParsedProject,
    target: 'HLR' | 'LLR',
): string[] {
    const out: string[] = [];
    if (target === 'HLR') {
        for (const h of project.flat_hlrs ?? []) {
            if (h.id) {
                out.push(h.id);
            }
        }
    } else {
        for (const l of project.flat_llrs ?? []) {
            if (l.id) {
                out.push(l.id);
            }
        }
    }
    out.sort();
    return out;
}

function resolveWorkspacePath(rel: string): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return undefined;
    }
    return vscode.Uri.file(path.join(folders[0].uri.fsPath, rel));
}
