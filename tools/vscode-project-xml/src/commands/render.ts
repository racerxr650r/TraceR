// `projectXml.renderAndPreview` and `projectXml.renderAll`.
//
// Both commands keep all rendering in the Python sidecar — they
// never reimplement template logic in TypeScript and never write
// preview output to disk. The renderAll command is the only path
// that writes to `doc/`, and only by passing `out` to the sidecar.
//
// The set of documents iterated by renderAll comes from the single
// named constant `BASELINE_DOCUMENTS` (see util/documents.ts) which
// the Phase 2.5 retrofit will swap for a `list_documents` sidecar
// call.

import * as vscode from 'vscode';
import { ProjectIoClient, SidecarError } from '../sidecar';
import {
    getProjectFolder,
    getProjectXmlPath,
    getToolsDir,
} from '../util/paths';
import {
    BASELINE_DOCUMENTS,
    BaselineDocument,
    findBaselineDocument,
    sourcePath,
    templatePath,
} from '../util/documents';
import {
    MarkdownPreviewProvider,
    previewUri,
} from '../preview/MarkdownPreviewProvider';

/**
 * Open the side-by-side Markdown preview for `docId`. If `docId` is
 * omitted, prompt the user with a QuickPick over BASELINE_DOCUMENTS.
 *
 * The preview is served by the `tracer-preview:` content provider;
 * no file is written under `doc/`.
 */
export async function renderAndPreview(
    preview: MarkdownPreviewProvider,
    arg?: string | { docId?: string },
): Promise<void> {
    const docId = await pickDocId(arg);
    if (!docId) {
        return;
    }
    if (!findBaselineDocument(docId)) {
        vscode.window.showWarningMessage(
            `Project Spec: unknown document id "${docId}".`,
        );
        return;
    }
    // Drop any stale cached render so the preview reflects the
    // current Project.xml state.
    preview.markStale(docId);
    const uri = previewUri(docId);
    try {
        await vscode.commands.executeCommand(
            'markdown.showPreviewToSide',
            uri,
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(
            `Project Spec: cannot open preview for ${docId} — ${message}`,
        );
    }
}

/**
 * Regenerate every spec under `doc/` by calling the sidecar's
 * `render` method with `out` set for each baseline document.
 *
 * The hard-coded list comes from `BASELINE_DOCUMENTS`; Phase 2.5
 * replaces it with `list_documents`. After a successful pass, every
 * tracked preview is marked stale so open previews refresh.
 */
export async function renderAll(
    client: ProjectIoClient,
    preview: MarkdownPreviewProvider,
    output: vscode.OutputChannel,
): Promise<void> {
    const tools = getToolsDir();
    const folder = getProjectFolder();
    const xmlPath = getProjectXmlPath();
    if (!tools || !folder || !xmlPath) {
        vscode.window.showWarningMessage(
            'Project Spec: workspace is not configured (toolsDir, workspace folder, or xmlPath missing).',
        );
        return;
    }

    const failures: { id: string; message: string }[] = [];
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Project Spec: rendering all documents',
            cancellable: false,
        },
        async (progress) => {
            const step = 100 / BASELINE_DOCUMENTS.length;
            for (const doc of BASELINE_DOCUMENTS) {
                progress.report({ message: doc.id, increment: step });
                try {
                    await client.render({
                        template: templatePath(tools, doc),
                        metadata_id: doc.id,
                        xml_path: xmlPath,
                        out: sourcePath(folder.uri.fsPath, doc),
                    });
                    output.appendLine(`[render] ${doc.id} → ${doc.source}`);
                } catch (err) {
                    const message = formatError(err);
                    output.appendLine(`[render] ${doc.id} FAILED: ${message}`);
                    failures.push({ id: doc.id, message });
                }
            }
        },
    );

    // Refresh open previews against the new on-disk state.
    preview.markStale();

    if (failures.length === 0) {
        vscode.window.showInformationMessage(
            `Project Spec: rendered ${BASELINE_DOCUMENTS.length} documents.`,
        );
    } else {
        const summary = failures.map((f) => f.id).join(', ');
        vscode.window.showErrorMessage(
            `Project Spec: ${failures.length} of ${BASELINE_DOCUMENTS.length} documents failed (${summary}). See the Project Spec output channel.`,
        );
    }
}

async function pickDocId(
    arg: string | { docId?: string } | undefined,
): Promise<string | undefined> {
    if (typeof arg === 'string' && arg) {
        return arg;
    }
    if (arg && typeof arg === 'object' && typeof arg.docId === 'string' && arg.docId) {
        return arg.docId;
    }
    const items: (vscode.QuickPickItem & { doc: BaselineDocument })[] =
        BASELINE_DOCUMENTS.map((doc) => ({
            label: doc.id,
            description: doc.title,
            detail: doc.source,
            doc,
        }));
    const pick = await vscode.window.showQuickPick(items, {
        title: 'Project Spec: render & preview',
        placeHolder: 'Choose a generated document to preview',
    });
    return pick?.doc.id;
}

function formatError(err: unknown): string {
    if (err instanceof SidecarError) {
        return `${err.message} (code ${err.code})`;
    }
    if (err instanceof Error) {
        return err.message;
    }
    return String(err);
}
