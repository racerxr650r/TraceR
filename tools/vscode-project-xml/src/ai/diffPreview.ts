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
import { AiRequestResult, EditOperation } from '../sidecar';

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

export interface DiffPreviewOptions {
    intent: string;
    label: string;
    /** The validated result whose `patch` and `lint` are being shown. */
    result: AiRequestResult;
    /** Markdown rendered before the patch listing (e.g. a one-line
     *  description of the target). */
    summary?: string;
}

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

function renderPreviewBody(options: DiffPreviewOptions): string {
    const { intent, result, summary } = options;
    const lines: string[] = [];
    lines.push(`# Project Spec AI — ${intent}`);
    if (summary) {
        lines.push('', summary);
    }
    lines.push('', `**Status:** ${result.kind}`);
    if (result.lint?.items) {
        const errors = result.lint.items.filter((i) => i.severity === 'error');
        const warnings = result.lint.items.filter((i) => i.severity === 'warning');
        lines.push(
            '',
            `**Lint:** ${errors.length} error(s), ${warnings.length} warning(s).`,
        );
        if (result.lint.items.length > 0) {
            lines.push('', '## Lint findings', '');
            for (const item of result.lint.items) {
                const code = item.code ? ` \`${item.code}\`` : '';
                lines.push(`- **${item.severity}**${code}: ${item.message}`);
            }
        }
    }
    if (result.advisory && result.advisory.length > 0) {
        lines.push('', '## Advisory findings', '');
        for (const item of result.advisory) {
            lines.push(`- ${JSON.stringify(item)}`);
        }
    }
    if (result.patch && result.patch.length > 0) {
        lines.push('', '## Proposed patch', '', '```json');
        lines.push(JSON.stringify(result.patch, null, 2));
        lines.push('```');
    } else {
        lines.push('', '_No patch operations._');
    }
    if (result.failures && result.failures.length > 0) {
        lines.push('', '## Failures', '');
        for (const f of result.failures) {
            lines.push(`- ${f}`);
        }
    }
    return lines.join('\n');
}

/** Render a single JSON-Patch operation as a one-line bullet. */
export function summarizeOperation(op: EditOperation): string {
    return `- ${op.op} \`${op.path}\``;
}
