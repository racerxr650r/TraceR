// Extension entry point. Wires up:
//   * the long-running project_io.py sidecar (JSON-RPC over stdio);
//   * the Project Spec tree view in the Activity Bar;
//   * the lint DiagnosticCollection mirrored from project_io.lint();
//   * the Reveal in Project.xml command on tree items.
//
// Phase 1 contract: read-only. No command in this file mutates
// Project.xml.

import * as vscode from 'vscode';
import { DocumentInfo, ProjectIoClient } from './sidecar';
import { ProjectSpecProvider } from './treeView/ProjectSpecProvider';
import { LintDiagnosticsProvider } from './diagnostics/LintDiagnosticsProvider';
import { buildBadgeIndex } from './util/badges';
import { revealInXml } from './commands/revealInXml';
import { renderAll, renderAndPreview } from './commands/render';
import {
    invalidateDocumentsCache,
    loadDocuments,
} from './util/documents';
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

    // Phase 2.5: register one `projectXml.render.<id>` command per
    // discovered `<metadata><document>` entry. Adding a new document
    // to Project.xml therefore exposes a new addressable render
    // command (palette / menu / keybinding target) on next refresh,
    // with no TypeScript edits required (PVD §6 #11).
    const dynamicRenderCommands = new Map<string, vscode.Disposable>();
    context.subscriptions.push({
        dispose: () => {
            for (const d of dynamicRenderCommands.values()) {
                d.dispose();
            }
            dynamicRenderCommands.clear();
        },
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('projectXml.refresh', async () => {
            invalidateDocumentsCache(sidecar);
            treeProvider.refresh();
            lensProvider.refresh();
            previewProvider.markStale();
            const result = await diagnostics.run();
            treeProvider.setBadges(buildBadgeIndex(result?.items));
            await syncDynamicRenderCommands(
                sidecar, previewProvider, dynamicRenderCommands, context, output,
            );
        }),
        vscode.commands.registerCommand('projectXml.lint', async () => {
            const result = await diagnostics.run();
            treeProvider.setBadges(buildBadgeIndex(result?.items));
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
                renderAndPreview(sidecar, previewProvider, arg),
        ),
        vscode.commands.registerCommand('projectXml.renderAll', () =>
            renderAll(sidecar, previewProvider, output),
        ),
        vscode.commands.registerCommand(PICK_RELATED_COMMAND, pickRelatedAndReveal),
    );

    void syncDynamicRenderCommands(
        sidecar, previewProvider, dynamicRenderCommands, context, output,
    );

    // Re-lint and refresh the tree whenever Project.xml is saved.
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
            const xmlPath = getProjectXmlPath();
            if (!xmlPath || doc.uri.fsPath !== xmlPath) {
                return;
            }
            invalidateDocumentsCache(sidecar);
            treeProvider.refresh();
            lensProvider.refresh();
            if (getConfig().get<boolean>('autoLintOnChange', true)) {
                void diagnostics.run().then((result) => {
                    treeProvider.setBadges(buildBadgeIndex(result?.items));
                });
            }
            if (getConfig().get<boolean>('previewOnSave', true)) {
                // Drop cached renders for every tracked preview so any
                // open Markdown preview pane reflects the new XML
                // state. The preview never writes to disk.
                previewProvider.markStale();
            }
            void syncDynamicRenderCommands(
                sidecar, previewProvider, dynamicRenderCommands, context, output,
            );
        }),
    );

    // Initial population.
    void diagnostics.run().then((result) => {
        treeProvider.setBadges(buildBadgeIndex(result?.items));
    });
}

export function deactivate(): void {
    // sidecar disposes itself via context.subscriptions.
}

/**
 * Discover the current document set via the sidecar and ensure that
 * a `projectXml.render.<id>` command is registered for each one.
 * Commands for documents that have disappeared from Project.xml are
 * disposed; new documents pick up a fresh registration. Safe to
 * call repeatedly — the caller passes the same map across
 * invocations so the bookkeeping is idempotent.
 */
async function syncDynamicRenderCommands(
    sidecar: ProjectIoClient,
    previewProvider: MarkdownPreviewProvider,
    registered: Map<string, vscode.Disposable>,
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
): Promise<void> {
    let docs: readonly DocumentInfo[];
    try {
        docs = await loadDocuments(sidecar);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output.appendLine(`[render-commands] discovery failed: ${message}`);
        return;
    }
    const seen = new Set<string>();
    for (const doc of docs) {
        seen.add(doc.id);
        if (registered.has(doc.id)) {
            continue;
        }
        const cmdId = `projectXml.render.${doc.id}`;
        const disposable = vscode.commands.registerCommand(cmdId, () =>
            renderAndPreview(sidecar, previewProvider, doc.id),
        );
        registered.set(doc.id, disposable);
        context.subscriptions.push(disposable);
        output.appendLine(`[render-commands] registered ${cmdId}`);
    }
    for (const [id, disposable] of registered) {
        if (!seen.has(id)) {
            disposable.dispose();
            registered.delete(id);
            output.appendLine(`[render-commands] disposed projectXml.render.${id}`);
        }
    }
}
