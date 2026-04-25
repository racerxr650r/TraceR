// In-memory content provider for the `tracer-preview:` URI scheme.
//
// Per HLR-027 / SDD §18, the side-by-side Markdown preview must
// never write to disk. This provider serves rendered Markdown for
// `tracer-preview:/<doc-id>.md` URIs by calling the sidecar's
// `render` method on demand. The content is cached per doc id so
// VS Code's preview pane can re-read it cheaply; cache entries are
// invalidated by `markStale(docId)`, which fires onDidChange and
// causes VS Code to re-request content.
//
// Phase 2.5: the document set is discovered via the sidecar's
// `list_documents` method (see util/documents.ts) so a new
// generated document picks up a working preview pane on next
// refresh, with no TypeScript edits required.

import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectIoClient, SidecarError } from '../sidecar';
import { getProjectFolder, getProjectXmlPath } from '../util/paths';
import {
    BaselineDocument,
    findBaselineDocument,
    loadDocuments,
    templatePath,
} from '../util/documents';

export const PREVIEW_SCHEME = 'tracer-preview';

/** Build the canonical preview URI for a baseline document. */
export function previewUri(docId: string): vscode.Uri {
    return vscode.Uri.parse(`${PREVIEW_SCHEME}:/${docId}.md`);
}

/**
 * Extract the doc id from a `tracer-preview:/<id>.md` URI. Returns
 * undefined for URIs in the wrong shape.
 */
export function previewDocId(uri: vscode.Uri): string | undefined {
    if (uri.scheme !== PREVIEW_SCHEME) {
        return undefined;
    }
    // uri.path is "/<id>.md" or "<id>.md" depending on how it was parsed.
    const base = path.posix.basename(uri.path);
    if (!base.endsWith('.md')) {
        return undefined;
    }
    return base.slice(0, -'.md'.length);
}

export class MarkdownPreviewProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    /** doc id → last rendered markdown (cleared by markStale). */
    private readonly cache = new Map<string, string>();

    /** doc ids the user has previewed at least once this session. */
    private readonly tracked = new Set<string>();

    constructor(
        private readonly client: ProjectIoClient,
        private readonly outputChannel: vscode.OutputChannel,
    ) {}

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const docId = previewDocId(uri);
        if (!docId) {
            return `# Project Spec preview\n\nUnknown preview URI: \`${uri.toString()}\`.\n`;
        }
        this.tracked.add(docId);
        const cached = this.cache.get(docId);
        if (cached !== undefined) {
            return cached;
        }
        let docs: readonly BaselineDocument[];
        try {
            docs = await loadDocuments(this.client);
        } catch (err) {
            const message = formatError(err);
            this.outputChannel.appendLine(
                `[preview] list_documents failed: ${message}`,
            );
            return `# Project Spec preview — discovery failed\n\n${message}\n`;
        }
        const doc = findBaselineDocument(docs, docId);
        if (!doc) {
            return `# Project Spec preview\n\nUnknown document id \`${docId}\`. Known ids: ${docs.map((d) => d.id).join(', ')}.\n`;
        }
        try {
            const rendered = await this.renderToString(doc);
            this.cache.set(docId, rendered);
            return rendered;
        } catch (err) {
            const message = formatError(err);
            this.outputChannel.appendLine(
                `[preview] render(${docId}) failed: ${message}`,
            );
            return `# Project Spec preview — render failed\n\n\`${docId}\`: ${message}\n`;
        }
    }

    /**
     * Drop the cached markdown for `docId` and notify VS Code so it
     * re-requests content. Pass undefined to invalidate every tracked
     * preview (used by the on-save refresh path).
     */
    markStale(docId?: string): void {
        if (docId === undefined) {
            this.cache.clear();
            for (const id of this.tracked) {
                this._onDidChange.fire(previewUri(id));
            }
            return;
        }
        this.cache.delete(docId);
        if (this.tracked.has(docId)) {
            this._onDidChange.fire(previewUri(docId));
        }
    }

    /** True if the user has opened a preview for `docId` this session. */
    isTracked(docId: string): boolean {
        return this.tracked.has(docId);
    }

    private async renderToString(doc: BaselineDocument): Promise<string> {
        const folder = getProjectFolder();
        const xmlPath = getProjectXmlPath();
        if (!folder || !xmlPath) {
            throw new Error(
                'Project Spec: workspace is not configured (workspace folder or xmlPath missing).',
            );
        }
        const result = await this.client.render({
            template: templatePath(folder.uri.fsPath, doc),
            metadata_id: doc.id,
            xml_path: xmlPath,
        });
        return result.output;
    }

    dispose(): void {
        this._onDidChange.dispose();
        this.cache.clear();
        this.tracked.clear();
    }
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
