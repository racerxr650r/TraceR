// `projectXml.renderAndPreview` and `projectXml.renderAll`.
//
// Phase 2.5 retrofit: both commands discover the document set
// dynamically via `loadDocuments(client)` (which calls the sidecar's
// `list_documents` JSON-RPC method). Adding a new generated document
// to Project.xml therefore makes it appear in the QuickPick and the
// renderAll loop with zero TypeScript edits.
//
// Both commands keep all rendering in the Python sidecar — they
// never reimplement template logic in TypeScript and never write
// preview output to disk. The renderAll command is the only path
// that writes to `doc/`, and only by passing `out` to the sidecar.

import * as vscode from 'vscode';
import { DocumentInfo, ProjectIoClient, SidecarError } from '../sidecar';
import {
    getProjectFolder,
    getProjectXmlPath,
} from '../util/paths';
import {
    findBaselineDocument,
    loadDocuments,
    sourcePath,
    templatePath,
} from '../util/documents';
import {
    MarkdownPreviewProvider,
    previewUri,
} from '../preview/MarkdownPreviewProvider';

/**
 * Open the side-by-side Markdown preview for `docId`. If `docId` is
 * omitted, prompt the user with a QuickPick over the documents
 * discovered via `list_documents`.
 *
 * The preview is served by the `tracer-preview:` content provider;
 * no file is written under `doc/`.
 */
export async function renderAndPreview(
    client: ProjectIoClient,
    preview: MarkdownPreviewProvider,
    arg?: string | { docId?: string },
): Promise<void> {
    let docs: readonly DocumentInfo[];
    try {
        docs = await loadDocuments(client);
    } catch (err) {
        vscode.window.showErrorMessage(
            `Project Spec: cannot enumerate documents — ${formatError(err)}`,
        );
        return;
    }
    const docId = await pickDocId(docs, arg);
    if (!docId) {
        return;
    }
    if (!findBaselineDocument(docs, docId)) {
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
        vscode.window.showErrorMessage(
            `Project Spec: cannot open preview for ${docId} — ${formatError(err)}`,
        );
    }
}

/**
 * Regenerate every spec under `doc/` by calling the sidecar's
 * `render` method with `out` set for each discovered document.
 *
 * The set comes from `loadDocuments(client)`; new documents
 * registered in Project.xml are picked up automatically. After a
 * successful pass, every tracked preview is marked stale so open
 * previews refresh.
 */
export async function renderAll(
    client: ProjectIoClient,
    preview: MarkdownPreviewProvider,
    output: vscode.OutputChannel,
): Promise<void> {
    const folder = getProjectFolder();
    const xmlPath = getProjectXmlPath();
    if (!folder || !xmlPath) {
        vscode.window.showWarningMessage(
            'Project Spec: workspace is not configured (workspace folder or xmlPath missing).',
        );
        return;
    }

    let docs: readonly DocumentInfo[];
    try {
        docs = await loadDocuments(client);
    } catch (err) {
        vscode.window.showErrorMessage(
            `Project Spec: cannot enumerate documents — ${formatError(err)}`,
        );
        return;
    }
    if (docs.length === 0) {
        vscode.window.showWarningMessage(
            'Project Spec: no <metadata><document> entries to render.',
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
            const step = 100 / docs.length;
            for (const doc of docs) {
                progress.report({ message: doc.id, increment: step });
                try {
                    await client.render({
                        template: templatePath(folder.uri.fsPath, doc),
                        metadata_id: doc.id,
                        xml_path: xmlPath,
                        out: sourcePath(folder.uri.fsPath, doc),
                    });
                    output.appendLine(`[render] ${doc.id} → ${doc.output}`);
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
            `Project Spec: rendered ${docs.length} documents.`,
        );
    } else {
        const summary = failures.map((f) => f.id).join(', ');
        vscode.window.showErrorMessage(
            `Project Spec: ${failures.length} of ${docs.length} documents failed (${summary}). See the Project Spec output channel.`,
        );
    }
}

async function pickDocId(
    docs: readonly DocumentInfo[],
    arg: string | { docId?: string } | undefined,
): Promise<string | undefined> {
    if (typeof arg === 'string' && arg) {
        return arg;
    }
    if (arg && typeof arg === 'object' && typeof arg.docId === 'string' && arg.docId) {
        return arg.docId;
    }
    if (docs.length === 0) {
        vscode.window.showWarningMessage(
            'Project Spec: no <metadata><document> entries to preview.',
        );
        return undefined;
    }
    const items: (vscode.QuickPickItem & { doc: DocumentInfo })[] =
        docs.map((doc) => ({
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
