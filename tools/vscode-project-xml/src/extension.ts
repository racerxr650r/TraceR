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

    context.subscriptions.push(
        vscode.commands.registerCommand('projectXml.refresh', async () => {
            treeProvider.refresh();
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
    );

    // Re-lint and refresh the tree whenever Project.xml is saved.
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
            const xmlPath = getProjectXmlPath();
            if (!xmlPath || doc.uri.fsPath !== xmlPath) {
                return;
            }
            treeProvider.refresh();
            if (getConfig().get<boolean>('autoLintOnChange', true)) {
                void diagnostics.run();
            }
        }),
    );

    // Initial population.
    void diagnostics.run();
}

export function deactivate(): void {
    // sidecar disposes itself via context.subscriptions.
}
