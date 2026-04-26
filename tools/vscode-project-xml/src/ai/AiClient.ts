// Phase 5b — AI client orchestration (HLR-029..033, HLR-049, HLR-052).
//
// Bridges `vscode.lm.*` (the language-model API) and the Python
// sidecar's `ai_request` JSON-RPC method. The Python side never calls
// a model (HLR-045); this client does the model call, hands the raw
// response back to the sidecar for validation+translation, and (once
// the user accepts) drives the second `ai_request` call that executes
// the real `apply_edit` write.
//
// Surfaces the diff-preview-and-apply gate (HLR-032). For
// `apply_edit`-shaped intents the flow is:
//
//   1. `ai_request(mode=prepare)` → sidecar returns the system prompt.
//   2. `vscode.lm.sendRequest()`   → returns text.
//   3. `ai_request(write=false)`   → sidecar validates + translates +
//      runs `apply_edit` in dry-run; result is `validated`/`rejected`.
//      On `rejected` the sidecar's `retry_feedback` is fed back into
//      the LM (one retry is allowed by default).
//   4. Diff preview shown to the user; on accept,
//      `ai_request(write=true)` is called for the real write.
//
// Provenance is appended by the sidecar on every terminal step.

import * as vscode from 'vscode';
import {
    AiCapabilityProvider,
    aiAutoApplyValidatedSetting,
    aiHistoryLogSetting,
    aiMaxTokensSetting,
    aiModelFamilySetting,
} from './capabilities';
import {
    AiRequestParams,
    AiRequestResult,
    AiTarget,
    LintFinding,
    ProjectIoClient,
    SidecarError,
} from '../sidecar';
import { getProjectFolder, getProjectXmlPath } from '../util/paths';

export interface RunIntentOptions {
    intent: string;
    target: AiTarget;
    userPrompt: string;
    /** Cancellation token from the chat request (or command). */
    token?: vscode.CancellationToken;
    /** When false (default), the second sidecar call uses `write=false`
     *  so the user can preview the patch before it lands. The chat
     *  participant always passes `false` and routes accepted patches
     *  through `applyAccepted()`. */
    autoApply?: boolean;
    /** Per-request override of `projectXml.ai.maxTokens`. */
    maxTokens?: number;
    /** Lint findings list for `gap.fix` (HLR-051). */
    lintFindings?: unknown[];
}

/** Concrete outcome of a single end-to-end intent run. */
export interface RunIntentOutcome {
    /** The sidecar's terminal step (`applied` / `validated` / `rejected`
     *  / `advisory` / `draft_pvd` / `no-model`). */
    result: AiRequestResult;
    /** Stable identifier of the LM that produced the response, when
     *  resolved. */
    modelId?: string;
    /** Final user prompt that was sent to the LM, after grounding. */
    systemPrompt?: string;
    /** Raw model response (last attempt). Undefined when no LM ran. */
    rawResponse?: string;
    /** True when the patch is `validated` (dry-run) and is awaiting an
     *  apply decision. */
    pendingApply: boolean;
}

export interface ApplyAcceptedOptions {
    intent: string;
    target: AiTarget;
    userPrompt: string;
    /** The original raw response from the LM that produced the patch. */
    response: string;
    /** Number of retries the original run consumed. */
    retries?: number;
    modelId?: string;
}

/**
 * Convenience wrapper for a single chat-participant turn. Keeps the
 * `vscode.lm.*` plumbing, the sidecar JSON-RPC contract, and the
 * cancellation/error handling in one place so the chat participant,
 * the AI tree commands, and the AI Quick Fix variants all share the
 * exact same code path.
 */
export class AiClient {
    constructor(
        private readonly sidecar: ProjectIoClient,
        private readonly capabilities: AiCapabilityProvider,
        private readonly outputChannel: vscode.OutputChannel,
    ) {}

    /** End-to-end intent run; throws if AI is not currently available. */
    async runIntent(options: RunIntentOptions): Promise<RunIntentOutcome> {
        this.capabilities.requireAvailable();

        const xmlPath = getProjectXmlPath();
        const historyDir = getProjectFolder()?.uri.fsPath;
        const baseParams: AiRequestParams = {
            intent: options.intent,
            target: options.target,
            user_prompt: options.userPrompt,
            xml_path: xmlPath,
            history_dir: historyDir,
            history_enabled: aiHistoryLogSetting(),
            max_tokens: options.maxTokens ?? aiMaxTokensSetting(),
            lint_findings: options.lintFindings,
        };

        // Step 1: prepare → fetch the system prompt.
        const prepared = await this.sidecar.aiRequest(baseParams);
        if (prepared.kind !== 'prompt' || !prepared.prompt) {
            // PVD ghostwriter, advisory, or some intents may produce a
            // terminal result on the first call (no model needed). For
            // the common authoring path this is unexpected.
            return { result: prepared, pendingApply: false };
        }

        // Step 2: model → response. Allow one retry on rejection.
        const model = await this.pickModel();
        if (!model) {
            return {
                result: rejectedNoModel(options.intent, options.target),
                pendingApply: false,
                systemPrompt: prepared.prompt,
            };
        }
        const modelId = model.id;
        let retries = 0;
        let rawResponse = await this.askModel(
            model, prepared.prompt, undefined, options.token,
        );
        if (rawResponse === undefined) {
            return {
                result: rejectedNoModel(options.intent, options.target),
                pendingApply: false,
                systemPrompt: prepared.prompt,
                modelId,
            };
        }
        // Step 3: evaluate (dry-run unless caller forces auto-apply).
        const writeFromCaller = options.autoApply ?? aiAutoApplyValidatedSetting();
        let evaluation = await this.sidecar.aiRequest({
            ...baseParams,
            model_response: rawResponse,
            model: modelId,
            retry_count: retries,
            write: writeFromCaller,
        });

        if (
            evaluation.kind === 'rejected' &&
            evaluation.retry_feedback &&
            evaluation.retry_feedback.length > 0
        ) {
            retries += 1;
            const retryPrompt = await this.sidecar.aiRequest(baseParams);
            if (retryPrompt.kind === 'prompt' && retryPrompt.prompt) {
                const retryResponse = await this.askModel(
                    model,
                    retryPrompt.prompt,
                    evaluation.retry_feedback,
                    options.token,
                );
                if (retryResponse !== undefined) {
                    rawResponse = retryResponse;
                    evaluation = await this.sidecar.aiRequest({
                        ...baseParams,
                        model_response: rawResponse,
                        model: modelId,
                        retry_count: retries,
                        write: writeFromCaller,
                    });
                }
            }
        }

        const pendingApply =
            evaluation.kind === 'validated' &&
            !writeFromCaller &&
            !!evaluation.patch &&
            evaluation.patch.length > 0;

        return {
            result: evaluation,
            modelId,
            systemPrompt: prepared.prompt,
            rawResponse,
            pendingApply,
        };
    }

    /**
     * Persist a `validated` patch by re-running the sidecar with
     * `write=true`. Used by the diff-preview-and-apply gate when the
     * user clicks "Apply" on the proposed diff. A backup copy of the
     * pre-edit `Project.xml` is written next to the file before the
     * apply call so the user can revert from disk if the result is
     * unexpected (HLR-032).
     */
    async applyAccepted(options: ApplyAcceptedOptions): Promise<AiRequestResult> {
        this.capabilities.requireAvailable();
        await this.backupProjectXml();
        const xmlPath = getProjectXmlPath();
        const historyDir = getProjectFolder()?.uri.fsPath;
        return this.sidecar.aiRequest({
            intent: options.intent,
            target: options.target,
            user_prompt: options.userPrompt,
            model_response: options.response,
            model: options.modelId,
            retry_count: options.retries ?? 0,
            write: true,
            xml_path: xmlPath,
            history_dir: historyDir,
            history_enabled: aiHistoryLogSetting(),
            max_tokens: aiMaxTokensSetting(),
        });
    }

    private async pickModel(): Promise<vscode.LanguageModelChat | undefined> {
        const lm = (vscode as { lm?: { selectChatModels?: typeof vscode.lm.selectChatModels } }).lm;
        if (!lm?.selectChatModels) {
            return undefined;
        }
        const family = aiModelFamilySetting();
        try {
            const models = await lm.selectChatModels(
                family ? { family } : undefined,
            );
            return models?.[0];
        } catch (err) {
            this.outputChannel.appendLine(
                `[ai] selectChatModels failed: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return undefined;
        }
    }

    private async askModel(
        model: vscode.LanguageModelChat,
        systemPrompt: string,
        retryFeedback: string[] | undefined,
        token?: vscode.CancellationToken,
    ): Promise<string | undefined> {
        const messages: vscode.LanguageModelChatMessage[] = [
            vscode.LanguageModelChatMessage.User(systemPrompt),
        ];
        if (retryFeedback && retryFeedback.length > 0) {
            messages.push(
                vscode.LanguageModelChatMessage.User(retryFeedback.join('\n')),
            );
        }
        const cts = token ?? new vscode.CancellationTokenSource().token;
        try {
            const request = await model.sendRequest(messages, {}, cts);
            const chunks: string[] = [];
            for await (const chunk of request.text) {
                chunks.push(chunk);
            }
            return chunks.join('');
        } catch (err) {
            this.outputChannel.appendLine(
                `[ai] sendRequest failed: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return undefined;
        }
    }

    /**
     * Write a timestamped copy of `Project.xml` next to the file so a
     * user who dislikes the AI's edit can revert from disk. Failure to
     * back up is logged but not fatal — the actual write still runs
     * because `apply_edit` itself only persists on a clean validation.
     */
    private async backupProjectXml(): Promise<void> {
        const xmlPath = getProjectXmlPath();
        if (!xmlPath) {
            return;
        }
        const folder = getProjectFolder();
        if (!folder) {
            return;
        }
        try {
            const xmlUri = vscode.Uri.file(xmlPath);
            const bytes = await vscode.workspace.fs.readFile(xmlUri);
            const stamp = new Date()
                .toISOString()
                .replace(/[:.]/g, '-');
            const backupRoot = vscode.Uri.joinPath(
                folder.uri, '.edit_doc', 'backups',
            );
            await vscode.workspace.fs.createDirectory(backupRoot);
            const backupUri = vscode.Uri.joinPath(
                backupRoot, `Project.xml.${stamp}.bak`,
            );
            await vscode.workspace.fs.writeFile(backupUri, bytes);
            this.outputChannel.appendLine(
                `[ai] backup: ${backupUri.fsPath}`,
            );
        } catch (err) {
            this.outputChannel.appendLine(
                `[ai] backup failed: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }
    }
}

function rejectedNoModel(intent: string, target: AiTarget): AiRequestResult {
    return {
        kind: 'no-model',
        intent,
        target,
        retries: 0,
        failures: ['no language model available'],
    };
}

/** Format an `ApplyEditResult.findings`-shaped lint result for chat. */
export function formatLintFindings(items: readonly LintFinding[] | undefined): string {
    if (!items || items.length === 0) {
        return '';
    }
    return items
        .map((f) => `- **${f.severity}** ${f.code ? `[${f.code}]` : ''} ${f.message}`)
        .join('\n');
}

export { SidecarError };
