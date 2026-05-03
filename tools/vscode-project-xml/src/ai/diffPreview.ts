// Phase 5b — Diff-preview-and-apply gate (HLR-032).
//
// Surfaces a `validated` AI patch as a Markdown diff in a virtual
// document and asks the user to confirm before the patch is applied.
// On accept the caller's `onAccept` callback is invoked (which calls
// `AiClient.applyAccepted`); on reject the proposed patch is
// discarded and provenance for the rejection is left to the sidecar.
//
// The `tracer-ai-preview:` content provider is registered once at
// extension activation. Each preview gets a unique URI keyed on the
// intent + a monotonically increasing counter so multiple previews
// can stack.
//
// The actual on-disk diff (`Project.xml` before vs. after) is
// rendered by VS Code's built-in diff editor using a virtual `after`
// document the sidecar produced when it ran `apply_edit` in dry-run
// mode. The user's accept/reject flows through a modal information
// dialog so the choice is unambiguous and the gate cannot be bypassed
// by a stray click.

import * as vscode from 'vscode';
import {
    renderPreviewBody as _renderPreviewBody,
    summarizeOperation as _summarizeOperation,
} from './diffPreviewLogic';
export type { DiffPreviewData } from './diffPreviewLogic';

// Re-export for backward compat.
export const renderPreviewBody = _renderPreviewBody;
export const summarizeOperation = _summarizeOperation;

export const PREVIEW_SCHEME = 'tracer-ai-preview';

/**
 * In-memory virtual-document content provider for the AI diff
 * preview. Each preview is keyed on its URI; closing the preview
 * editor evicts the entry on the next garbage collection turn.
 */
export class AiPreviewProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.emitter.event;
    private readonly contents = new Map<string, string>();
    private counter = 0;

    /** Register a preview body and return the URI to open. */
    register(label: string, body: string): vscode.Uri {
        this.counter += 1;
        const safe = label.replace(/[^a-zA-Z0-9_.-]/g, '-');
        const uri = vscode.Uri.parse(
            `${PREVIEW_SCHEME}:/${safe}-${this.counter}.md`,
        );
        this.contents.set(uri.toString(), body);
        this.emitter.fire(uri);
        return uri;
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contents.get(uri.toString()) ?? '';
    }

    dispose(): void {
        this.contents.clear();
        this.emitter.dispose();
    }
}

export type DiffPreviewOptions = import('./diffPreviewLogic').DiffPreviewData;

/**
 * Show the proposed patch and lint outcome in a side editor and ask
 * the user (modal) whether to apply. Returns `true` on accept.
 *
 * Implemented as a Markdown preview rather than a full text-diff
 * because the patch is a list of JSON-Patch operations against the
 * parsed XML tree, not a textual rewrite — a textual diff would be
 * misleading. The listing matches the JSON-Patch shape consumed by
 * `apply_edit`, so power users can spot-check it directly.
 */
export async function showAiDiffPreview(
    provider: AiPreviewProvider,
    options: DiffPreviewOptions,
): Promise<boolean> {
    const body = renderPreviewBody(options);
    const uri = provider.register(`${options.intent}.${options.label}`, body);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside,
    });
    const choice = await vscode.window.showInformationMessage(
        `Project Spec AI: apply the proposed ${options.intent} patch?`,
        { modal: true },
        'Apply',
        'Cancel',
    );
    return choice === 'Apply';
}
