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
import { getConfig, getProjectXmlPath, setExtensionContext } from './util/paths';
import { checkBundledToolsFreshness } from './util/freshness';
import { LintStatusBar } from './statusBar';
import { registerScaffoldToolsCommand } from './commands/scaffoldTools';
import {
    FIX_BROKEN_TRACE,
    FIX_ID_FORMAT,
    FIX_MISSING_TEMPLATE,
    FIX_NO_TEST,
    QuickFixProvider,
} from './codeActions/QuickFixProvider';
import {
    fixBrokenTrace,
    fixIdFormat,
    fixMissingTemplate,
    fixNoTest,
} from './commands/quickFixes';
import { FormPanelProvider } from './forms/FormPanelProvider';
import { addHlr, addLlr, addModule, addStpFixture, addTest, addTestFile, editPayload } from './commands/forms';
import { initProject } from './commands/initProject';
import { AiCapabilityProvider } from './ai/capabilities';
import { AiClient } from './ai/AiClient';
import { AiPreviewProvider, PREVIEW_SCHEME as AI_PREVIEW_SCHEME } from './ai/diffPreview';
import { registerProjectSpecParticipant } from './ai/participant';
import { registerAiTreeCommands } from './ai/treeMenu';
import {
    AI_FIX_SUGGEST_TRACE,
    AiQuickFixProvider,
    runAiSuggestTrace,
} from './ai/quickFix';
import { registerResolveMergeCommand } from './commands/resolveMerge';

export function activate(context: vscode.ExtensionContext): void {
    setExtensionContext(context);
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

    // Phase 6 (HLR-042): status bar showing n errors / m warnings
    // for Project.xml. Subscribed to lint runs below.
    const statusBar = new LintStatusBar();
    context.subscriptions.push(statusBar);

    // Phase 6 (LLR-PKG-04, HLR-061): scaffold the bundled tools/
    // tree into the workspace.
    registerScaffoldToolsCommand(context);

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

    // Phase 2.5c: payload-agnostic Quick Fix table keyed on
    // Finding.code (broken-trace / id-format / missing-template /
    // no-test). Registered for any XML document; the provider itself
    // gates on diag.source === 'projectXml'.
    const quickFixProvider = new QuickFixProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { language: 'xml', scheme: 'file' },
            quickFixProvider,
            { providedCodeActionKinds: QuickFixProvider.providedCodeActionKinds },
        ),
        vscode.commands.registerCommand(FIX_BROKEN_TRACE, (args) =>
            fixBrokenTrace(sidecar, args),
        ),
        vscode.commands.registerCommand(FIX_ID_FORMAT, (args) =>
            fixIdFormat(sidecar, args),
        ),
        vscode.commands.registerCommand(FIX_MISSING_TEMPLATE, (args) =>
            fixMissingTemplate(args),
        ),
        vscode.commands.registerCommand(FIX_NO_TEST, (args) =>
            fixNoTest(sidecar, args),
        ),
    );

    // Phase 5b — Inline AI assistance (HLR-029..033, HLR-044..045,
    // HLR-048..053). Capability provider gates every AI surface; the
    // chat participant, AI tree menu command, and AI Quick Fix variant
    // re-evaluate when settings, workspace trust, or chat-model
    // availability change. Deterministic surfaces (above) keep working
    // when AI is unavailable.
    const capabilities = new AiCapabilityProvider(output);
    context.subscriptions.push(capabilities);
    const aiPreview = new AiPreviewProvider();
    context.subscriptions.push(aiPreview);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            AI_PREVIEW_SCHEME,
            aiPreview,
        ),
    );
    const aiClient = new AiClient(sidecar, capabilities, output);

    // Re-register the chat participant on every capability flip so
    // `@projectspec` disappears cleanly when no LM is available, the
    // workspace becomes untrusted, or `projectXml.ai.enabled` is false.
    let participantDisposable: vscode.Disposable | undefined;
    const syncParticipant = (): void => {
        const available = capabilities.state().available;
        if (available && !participantDisposable) {
            participantDisposable = registerProjectSpecParticipant({
                capabilities,
                aiClient,
                preview: aiPreview,
                output,
            });
            context.subscriptions.push(participantDisposable);
        } else if (!available && participantDisposable) {
            participantDisposable.dispose();
            participantDisposable = undefined;
        }
    };
    context.subscriptions.push(capabilities.onDidChange(() => syncParticipant()));
    void capabilities.refresh().then(() => syncParticipant());

    // Schema-driven AI tree-menu command (HLR-053). Single command id;
    // the visible per-node intent list is derived from
    // `ui_hints_index[<type>].ai_actions` at call time.
    registerAiTreeCommands(context, {
        capabilities,
        aiClient,
        sidecar,
        preview: aiPreview,
        output,
    });

    // AI Quick Fix variant on `broken-trace` diagnostics. Provider
    // returns no actions when AI is unavailable, so the deterministic
    // "Replace ref with…" entry remains the only Quick Fix.
    const aiQuickFix = new AiQuickFixProvider(capabilities);
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { language: 'xml', scheme: 'file' },
            aiQuickFix,
            { providedCodeActionKinds: AiQuickFixProvider.providedCodeActionKinds },
        ),
        vscode.commands.registerCommand(AI_FIX_SUGGEST_TRACE, (args) =>
            runAiSuggestTrace(
                {
                    capabilities,
                    aiClient,
                    preview: aiPreview,
                    output,
                },
                args,
            ),
        ),
    );

    // Phase 5.5: AI-assisted merge conflict resolution.
    context.subscriptions.push(
        registerResolveMergeCommand({
            sidecar, capabilities, aiClient, output,
        }),
    );

    // Phase 3 + Phase 4 form panel commands. Each registered command
    // opens the same FormPanelProvider keyed on a different complex
    // type from the XSD's `ui_hints_index`.
    const formPanel = new FormPanelProvider(context, sidecar, output);
    context.subscriptions.push(
        vscode.commands.registerCommand('projectXml.addHlr', () =>
            addHlr(sidecar, formPanel),
        ),
        vscode.commands.registerCommand('projectXml.addLlr', () =>
            addLlr(sidecar, formPanel),
        ),
        vscode.commands.registerCommand('projectXml.editPayload', (args) =>
            editPayload(formPanel, args),
        ),
        // Phase 4 additions:
        vscode.commands.registerCommand('projectXml.addModule', () =>
            addModule(sidecar, formPanel),
        ),
        vscode.commands.registerCommand('projectXml.addStpFixture', () =>
            addStpFixture(sidecar, formPanel),
        ),
        vscode.commands.registerCommand('projectXml.addTestFile', () =>
            addTestFile(sidecar, formPanel),
        ),
        vscode.commands.registerCommand('projectXml.addTest', () =>
            addTest(sidecar, formPanel),
        ),
        vscode.commands.registerCommand('projectXml.initProject', () =>
            initProject(sidecar),
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
            statusBar.update(result);
            await syncDynamicRenderCommands(
                sidecar, previewProvider, dynamicRenderCommands, context, output,
            );
        }),
        vscode.commands.registerCommand('projectXml.lint', async () => {
            const result = await diagnostics.run();
            treeProvider.setBadges(buildBadgeIndex(result?.items));
            statusBar.update(result);
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
                    statusBar.update(result);
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
        statusBar.update(result);
    });

    // Phase 6 (LLR-PKG-07, HLR-062): one-shot freshness check
    // comparing the bundled .bundle_version against the workspace's
    // tools/project.xsd schema_version. Never blocks activation;
    // never escalates to a warning or error.
    void checkBundledToolsFreshness(output);
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
