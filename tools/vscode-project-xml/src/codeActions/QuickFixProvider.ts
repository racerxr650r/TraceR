// Phase 2.5c — payload-agnostic Quick Fix table.
//
// Implements `vscode.CodeActionProvider` for `Project.xml`. The
// provider dispatches *only* on `vscode.Diagnostic.code` (which the
// `LintDiagnosticsProvider` mirrors from `Finding.code`); it never
// inspects payload element names. Adding a new `Finding.code` to the
// linter is therefore the only change needed to expose a new fix —
// the dispatch table below is the single seam (HLR-012, HLR-025).
//
// Every fix on this table uses `vscode.WorkspaceEdit` text edits so
// the Phase 3 `apply_edit` write path is not required (SDP §8 Phase
// 2.5c). Structural rewrites that need an XSD-validated round trip
// move onto `apply_edit` once it lands.

import * as vscode from 'vscode';
import { isFixableCode, QUICK_FIX_CODES } from './fixes';
import { SOURCE as DIAG_SOURCE } from '../diagnostics/LintDiagnosticsProvider';

/** Command ids dispatched from the Quick Fix table. */
export const FIX_BROKEN_TRACE = 'projectXml.fix.replaceTraceRef';
export const FIX_ID_FORMAT = 'projectXml.fix.renumberId';
export const FIX_MISSING_TEMPLATE = 'projectXml.fix.stubTemplate';
export const FIX_NO_TEST = 'projectXml.fix.createStubTest';

/**
 * Table mapping `Finding.code` → command id + Quick Fix title. The
 * provider consults this table and nothing else — there is no
 * branching on payload element name (HLR / LLR / plan / future
 * payloads), so a new payload kind that triggers an existing
 * Finding.code inherits the Quick Fix surface for free.
 */
export const FIX_TABLE: Record<string, { command: string; title: string }> = {
    'broken-trace': {
        command: FIX_BROKEN_TRACE,
        title: 'Project Spec: Replace ref with…',
    },
    'id-format': {
        command: FIX_ID_FORMAT,
        title: 'Project Spec: Renumber as next free id',
    },
    'missing-template': {
        command: FIX_MISSING_TEMPLATE,
        title: 'Project Spec: Stub the missing template file',
    },
    'no-test': {
        command: FIX_NO_TEST,
        title: 'Project Spec: Create stub test entry',
    },
};

export class QuickFixProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix,
    ];

    provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        _token: vscode.CancellationToken,
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        for (const diag of context.diagnostics) {
            if (diag.source !== DIAG_SOURCE) {
                continue;
            }
            const code = extractCode(diag.code);
            if (!isFixableCode(code)) {
                continue;
            }
            const entry = FIX_TABLE[code];
            const action = new vscode.CodeAction(
                entry.title,
                vscode.CodeActionKind.QuickFix,
            );
            action.diagnostics = [diag];
            action.isPreferred = true;
            action.command = {
                command: entry.command,
                title: entry.title,
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

/** `vscode.Diagnostic.code` may be a string, number, or `{value, target}`. */
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

/** Re-export so callers can poke at the codes the provider knows about. */
export { QUICK_FIX_CODES };
