// Phase 5b — AI Quick Fix variant on `broken-trace` diagnostics.
//
// The deterministic Quick Fix table in `QuickFixProvider` already
// offers "Project Spec: Replace ref with…" (an id-picker UI). This
// module adds a sibling "Project Spec: Suggest correct ref with AI"
// action that runs `suggest.traces` against the offending element and
// surfaces the result in the diff-preview-and-apply gate.
//
// Wiring lives here rather than inside `QuickFixProvider` so the
// payload-agnostic Phase 2.5c table stays minimal: this provider only
// activates when AI is currently available (capability provider gate)
// and only for the `broken-trace` Finding.code.

import * as vscode from 'vscode';
import { AiCapabilityProvider } from './capabilities';
import { AiClient } from './AiClient';
import { AiPreviewProvider, showAiDiffPreview } from './diffPreview';
import { AiTarget } from '../sidecar';
import { SOURCE as DIAG_SOURCE } from '../diagnostics/LintDiagnosticsProvider';

export const AI_FIX_SUGGEST_TRACE = 'projectXml.ai.fix.suggestTrace';

export interface AiQuickFixContext {
    capabilities: AiCapabilityProvider;
    aiClient: AiClient;
    preview: AiPreviewProvider;
    output: vscode.OutputChannel;
}

export class AiQuickFixProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix,
    ];

    constructor(private readonly capabilities: AiCapabilityProvider) {}

    provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        _token: vscode.CancellationToken,
    ): vscode.CodeAction[] {
        if (!this.capabilities.state().available) {
            return [];
        }
        const actions: vscode.CodeAction[] = [];
        for (const diag of context.diagnostics) {
            if (diag.source !== DIAG_SOURCE) {
                continue;
            }
            const code = extractCode(diag.code);
            if (code !== 'broken-trace') {
                continue;
            }
            const action = new vscode.CodeAction(
                'Project Spec: Suggest correct ref with AI',
                vscode.CodeActionKind.QuickFix,
            );
            action.diagnostics = [diag];
            action.command = {
                command: AI_FIX_SUGGEST_TRACE,
                title: action.title,
                arguments: [
                    {
                        uri: document.uri.toString(),
                        message: diag.message,
                        range: serializeRange(diag.range),
                    },
                ],
            };
            actions.push(action);
        }
        return actions;
    }
}

export interface AiSuggestTraceArgs {
    uri: string;
    message: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
}

/**
 * Command callback for `projectXml.ai.fix.suggestTrace`. Resolves the
 * offending element from the diagnostic message, runs `suggest.traces`
 * against it, and routes the result through the diff-preview-and-apply
 * gate.
 */
export async function runAiSuggestTrace(
    ctx: AiQuickFixContext,
    args: AiSuggestTraceArgs | undefined,
): Promise<void> {
    if (!args) {
        return;
    }
    try {
        ctx.capabilities.requireAvailable();
    } catch (err) {
        vscode.window.showWarningMessage(
            err instanceof Error ? err.message : String(err),
        );
        return;
    }
    const target = parseBrokenTraceTarget(args.message);
    if (!target) {
        vscode.window.showWarningMessage(
            'Project Spec AI: could not infer the target id from the diagnostic.',
        );
        return;
    }
    const userPrompt =
        `Suggest correct trace targets for ${target.type} ${target.id}. ` +
        `The current ref is broken; pick valid ones from the project.`;
    const outcome = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Project Spec AI — Suggest correct ref',
            cancellable: true,
        },
        (_p, token) =>
            ctx.aiClient.runIntent({
                intent: 'suggest.traces',
                target,
                userPrompt,
                token,
            }),
    );
    const { result, rawResponse, modelId, pendingApply } = outcome;
    if (result.kind === 'no-model') {
        vscode.window.showWarningMessage(
            'Project Spec AI: no language model is available.',
        );
        return;
    }
    if (result.kind === 'rejected') {
        vscode.window.showWarningMessage(
            `Suggest traces was rejected: ${(result.failures ?? []).join('; ')}`,
        );
        return;
    }
    if (result.kind !== 'validated' || !pendingApply || !rawResponse) {
        vscode.window.showInformationMessage(
            `Suggest traces returned ${result.kind}; nothing to apply.`,
        );
        return;
    }
    const accepted = await showAiDiffPreview(ctx.preview, {
        intent: 'suggest.traces',
        label: target.type,
        result,
        summary: `Replacing broken trace on \`${target.type}\` \`${target.id}\``,
    });
    if (!accepted) {
        vscode.window.showInformationMessage('Cancelled — no changes written.');
        return;
    }
    await ctx.aiClient.applyAccepted({
        intent: 'suggest.traces',
        target,
        userPrompt,
        response: rawResponse,
        retries: result.retries,
        modelId,
    });
    await vscode.commands.executeCommand('projectXml.refresh');
}

/**
 * Extract the offending element's complex type and id from the
 * lint message produced for `broken-trace`. The message format is
 * authored by `tools/lint_project.py`; the regex below mirrors the
 * parser used by the deterministic Quick Fix in `commands/quickFixes`.
 */
export function parseBrokenTraceTarget(message: string): AiTarget | undefined {
    // Examples handled by lint_project: `HLR-001 trace ref 'BAD' is unknown`,
    // `LLR-FOO-01 trace ref 'BAD' is unknown`, `test 'foo' has broken ref ...`.
    const hlr = /HLR-\d{3,}/i.exec(message);
    if (hlr) {
        return { type: 'Hlr', id: hlr[0].toUpperCase() };
    }
    const llr = /LLR-[A-Z0-9_]+-\d{2,}/i.exec(message);
    if (llr) {
        return { type: 'Llr', id: llr[0].toUpperCase() };
    }
    return undefined;
}

function extractCode(code: vscode.Diagnostic['code']): string | undefined {
    if (typeof code === 'string') {
        return code;
    }
    if (code && typeof code === 'object' && 'value' in code) {
        const value = (code as { value: unknown }).value;
        return typeof value === 'string' ? value : undefined;
    }
    return undefined;
}

function serializeRange(range: vscode.Range): {
    start: { line: number; character: number };
    end: { line: number; character: number };
} {
    return {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character },
    };
}
