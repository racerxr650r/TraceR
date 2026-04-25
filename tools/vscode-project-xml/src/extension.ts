// Extension entry point. Wires up:
//   * the long-running project_io.py sidecar (JSON-RPC over stdio);
//   * the Project Spec tree view in the Activity Bar;
//   * the lint DiagnosticCollection mirrored from project_io.lint();
//   * the Reveal in Project.xml command on tree items.
//
// Phase 1 contract: read-only. No command in this file mutates
// Project.xml.

import * as vscode from 'vscode';
import { ProjectIoClient } from './sidecar';
import { ProjectSpecProvider } from './treeView/ProjectSpecProvider';
import { LintDiagnosticsProvider } from './diagnostics/LintDiagnosticsProvider';
import { revealInXml } from './commands/revealInXml';
import { renderAll, renderAndPreview } from './commands/render';
import {
    CoverageCodeLensProvider,
    PICK_RELATED_COMMAND,
    pickRelatedAndReveal,
} from './codeLens/CoverageCodeLensProvider';
import {
    MarkdownPreviewProvider,
    PREVIEW_SCHEME,
} from './preview/MarkdownPreviewProvider';
import { getConfig, getProjectXmlPath } from './util/paths';

export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel('Project Spec');
    context.subscriptions.push(output);

    const sidecar = new ProjectIoClient(output);
    context.subscriptions.push(sidecar);

    const treeProvider = new ProjectSpecProvider(sidecar, output);
    const treeView = vscode.window.createTreeView('projectXml.tree', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    const diagnostics = new LintDiagnosticsProvider(sidecar, output);
    context.subscriptions.push(diagnostics);

    const previewProvider = new MarkdownPreviewProvider(sidecar, output);
    context.subscriptions.push(previewProvider);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            PREVIEW_SCHEME,
            previewProvider,
        ),
    );

    const lensProvider = new CoverageCodeLensProvider(sidecar, output);
    context.subscriptions.push(lensProvider);
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'xml', scheme: 'file' },
            lensProvider,
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('projectXml.refresh', async () => {
            treeProvider.refresh();
            lensProvider.refresh();
            previewProvider.markStale();
            await diagnostics.run();
        }),
        vscode.commands.registerCommand('projectXml.lint', async () => {
            const result = await diagnostics.run();
            if (result) {
                const e = result.errors.length;
                const w = result.warnings.length;
                vscode.window.showInformationMessage(
                    `Project Spec: ${e} error(s), ${w} warning(s).`,
                );
            }
        }),
        vscode.commands.registerCommand('projectXml.revealInXml', revealInXml),
        vscode.commands.registerCommand(
            'projectXml.renderAndPreview',
            (arg?: string | { docId?: string }) =>
                renderAndPreview(previewProvider, arg),
        ),
        vscode.commands.registerCommand('projectXml.renderAll', () =>
            renderAll(sidecar, previewProvider, output),
        ),
        vscode.commands.registerCommand(PICK_RELATED_COMMAND, pickRelatedAndReveal),
    );

    // Re-lint and refresh the tree whenever Project.xml is saved.
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
            const xmlPath = getProjectXmlPath();
            if (!xmlPath || doc.uri.fsPath !== xmlPath) {
                return;
            }
            treeProvider.refresh();
            lensProvider.refresh();
            if (getConfig().get<boolean>('autoLintOnChange', true)) {
                void diagnostics.run();
            }
            if (getConfig().get<boolean>('previewOnSave', true)) {
                // Drop cached renders for every tracked preview so any
                // open Markdown preview pane reflects the new XML
                // state. The preview never writes to disk.
                previewProvider.markStale();
            }
        }),
    );

    // Initial population.
    void diagnostics.run();
}

export function deactivate(): void {
    // sidecar disposes itself via context.subscriptions.
}
