// Phase 5b — AI capability gate (HLR-044, HLR-045).
//
// Computes whether the editor's AI surfaces (chat participant,
// schema-driven AI tree menu entries, AI Quick Fix variants) should
// be visible. Surfaces are visible only when *all* of the following
// hold:
//
//   1. The workspace is trusted (`vscode.workspace.isTrusted`).
//   2. The user has not disabled AI explicitly (`projectXml.ai.enabled`).
//   3. At least one chat model is available
//      (`vscode.lm.selectChatModels(...)` returns ≥ 1 entry).
//
// When any of these flips, the current `AiCapabilityState` is
// republished and the result is mirrored into the
// `projectXml.ai.available` context key so `package.json` `when`
// clauses can hide menu entries / context-menu groups cleanly. The
// chat participant and command callbacks must call `requireAvailable`
// before accepting a request.
//
// Deterministic surfaces (tree, diagnostics, lenses, form panels,
// render, Stage A merge from Phase 5.5) are unaffected by anything
// in this file — they keep working when AI is off.

import * as vscode from 'vscode';
import { getConfig } from '../util/paths';

export const AI_CONFIG_SECTION = 'projectXml.ai';
export const AI_CONTEXT_KEY = 'projectXml.ai.available';

export type AiUnavailableReason =
    | 'untrusted'
    | 'disabled'
    | 'no-model'
    | 'lm-api-missing';

export interface AiCapabilityState {
    /** When true, AI surfaces are live. */
    available: boolean;
    /** Populated only when `available` is false. */
    reason?: AiUnavailableReason;
    /** Best-effort human-readable explanation; safe to surface in toasts. */
    message?: string;
}

const UNAVAILABLE_MESSAGES: Record<AiUnavailableReason, string> = {
    untrusted:
        'Project Spec AI is disabled in untrusted workspaces.',
    disabled:
        'Project Spec AI is disabled in settings (projectXml.ai.enabled).',
    'no-model':
        'No language model is available (vscode.lm.selectChatModels returned none).',
    'lm-api-missing':
        'This VS Code build does not expose vscode.lm; AI surfaces are disabled.',
};

/** Read the user's `projectXml.ai.enabled` (default `true`). */
export function aiEnabledSetting(): boolean {
    return getConfig().get<boolean>('ai.enabled', true);
}

/** Read the configured model family (empty string → no constraint). */
export function aiModelFamilySetting(): string {
    return (getConfig().get<string>('ai.modelFamily', '') ?? '').trim();
}

/** Read the configured token budget for the grounding bundle. */
export function aiMaxTokensSetting(): number {
    const raw = getConfig().get<number>('ai.maxTokens', 8000);
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
        return 8000;
    }
    return Math.floor(raw);
}

/** Read whether validated patches should auto-apply (default `false`). */
export function aiAutoApplyValidatedSetting(): boolean {
    return getConfig().get<boolean>('ai.autoApplyValidated', false);
}

/** Read whether to append to `<workspace>/.edit_doc/ai_history.jsonl`. */
export function aiHistoryLogSetting(): boolean {
    return getConfig().get<boolean>('ai.historyLog', true);
}

/**
 * Tracks the live AI capability state and republishes it when settings,
 * workspace trust, or chat-model availability change. The chat
 * participant, AI tree menu, and AI Quick Fix variants subscribe so
 * they hide/show synchronously.
 */
export class AiCapabilityProvider implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<AiCapabilityState>();
    readonly onDidChange = this.emitter.event;
    private current: AiCapabilityState = { available: false, reason: 'disabled' };
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly outputChannel: vscode.OutputChannel) {
        // Re-evaluate when the user toggles a `projectXml.ai.*` setting.
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration(AI_CONFIG_SECTION)) {
                    void this.refresh();
                }
            }),
        );
        // Re-evaluate when the workspace trust state flips.
        this.disposables.push(
            vscode.workspace.onDidGrantWorkspaceTrust(() => {
                void this.refresh();
            }),
        );
        // Re-evaluate when the available chat models change (added/removed).
        const lm = (vscode as { lm?: { onDidChangeChatModels?: vscode.Event<void> } }).lm;
        if (lm?.onDidChangeChatModels) {
            this.disposables.push(lm.onDidChangeChatModels(() => void this.refresh()));
        }
    }

    state(): AiCapabilityState {
        return this.current;
    }

    /**
     * Recompute and publish if changed. Returns the new state. Safe
     * to call concurrently — only the resolved value is acted upon.
     */
    async refresh(): Promise<AiCapabilityState> {
        const next = await this.evaluate();
        const prev = this.current;
        this.current = next;
        await vscode.commands.executeCommand(
            'setContext',
            AI_CONTEXT_KEY,
            next.available,
        );
        if (
            prev.available !== next.available ||
            prev.reason !== next.reason
        ) {
            this.outputChannel.appendLine(
                `[ai] capability: available=${next.available}` +
                    (next.reason ? ` reason=${next.reason}` : ''),
            );
            this.emitter.fire(next);
        }
        return next;
    }

    /**
     * Evaluate the gate without mutating state. Public for tests; the
     * command path should call `refresh()` instead.
     */
    async evaluate(): Promise<AiCapabilityState> {
        if (!vscode.workspace.isTrusted) {
            return unavailable('untrusted');
        }
        if (!aiEnabledSetting()) {
            return unavailable('disabled');
        }
        const lm = (vscode as { lm?: { selectChatModels?: typeof vscode.lm.selectChatModels } }).lm;
        if (!lm?.selectChatModels) {
            return unavailable('lm-api-missing');
        }
        const family = aiModelFamilySetting();
        try {
            const models = await lm.selectChatModels(
                family ? { family } : undefined,
            );
            if (!models || models.length === 0) {
                return unavailable('no-model');
            }
        } catch (err) {
            this.outputChannel.appendLine(
                `[ai] selectChatModels failed: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return unavailable('no-model');
        }
        return { available: true };
    }

    /**
     * Throw if AI is not currently available; otherwise return the
     * state. Used by command callbacks so a stale entry-point can't
     * proceed past the gate.
     */
    requireAvailable(): AiCapabilityState {
        if (!this.current.available) {
            const reason = this.current.reason ?? 'disabled';
            const message = this.current.message ?? UNAVAILABLE_MESSAGES[reason];
            const err = new Error(message);
            (err as Error & { code?: string }).code = `ai/${reason}`;
            throw err;
        }
        return this.current;
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
        this.emitter.dispose();
    }
}

function unavailable(reason: AiUnavailableReason): AiCapabilityState {
    return {
        available: false,
        reason,
        message: UNAVAILABLE_MESSAGES[reason],
    };
}
