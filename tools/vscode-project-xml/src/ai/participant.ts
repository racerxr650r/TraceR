// Phase 5b — `@projectspec` chat participant (HLR-029, HLR-044, HLR-045).
//
// Registers a single chat participant that dispatches on the slash
// command in the request. Slash → intent mapping comes from
// `intents.ts` (which mirrors `tools/ai/registry.py`); the participant
// itself is intent-agnostic so adding a new intent in the registry +
// mirror lights up the chat command without further wiring.
//
// Each turn:
//   1. Parse the slash command and target hints from the prompt.
//   2. Call `AiClient.runIntent` (which orchestrates prepare → LM →
//      evaluate → optional retry).
//   3. Render the outcome as Markdown:
//      - `applied`   → success message with summary of the patch.
//      - `validated` → diff-preview-and-apply gate; on accept call
//                      `AiClient.applyAccepted`.
//      - `rejected`  → failure summary with retry feedback.
//      - `advisory`  → bulleted findings.
//      - `draft_pvd` → embedded Markdown (the proposed PVD text).
//      - `no-model`  → polite "no LM available" message; the
//                      capability provider hides the participant
//                      anyway so this branch is mostly defensive.
//
// The participant unregisters itself when the capability provider
// reports unavailable; activation re-registers when AI flips back on.

import * as vscode from 'vscode';
import { AiClient } from './AiClient';
import { AiCapabilityProvider } from './capabilities';
import {
    AiPreviewProvider,
    showAiDiffPreview,
} from './diffPreview';
import { INTENTS, IntentSpec, intentForSlash } from './intents';
import { AiRequestResult, AiTarget } from '../sidecar';

export const PARTICIPANT_ID = 'tracer.projectspec';

export interface ParticipantContext {
    capabilities: AiCapabilityProvider;
    aiClient: AiClient;
    preview: AiPreviewProvider;
    output: vscode.OutputChannel;
}

/**
 * Activate the chat participant. Returns a disposable that owns the
 * registration; callers (extension.ts) tear it down when AI becomes
 * unavailable so the slash commands disappear from the chat picker
 * cleanly (HLR-044).
 */
export function registerProjectSpecParticipant(
    ctx: ParticipantContext,
): vscode.Disposable {
    const chatApi = (vscode as { chat?: typeof vscode.chat }).chat;
    if (!chatApi?.createChatParticipant) {
        ctx.output.appendLine(
            '[ai] vscode.chat API missing; participant not registered',
        );
        return new vscode.Disposable(() => undefined);
    }
    const handler: vscode.ChatRequestHandler = async (request, _ctx, stream, token) => {
        try {
            return await handleTurn(ctx, request, stream, token);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            stream.markdown(`**Project Spec AI error:** ${message}`);
            return { errorDetails: { message } };
        }
    };
    const participant = chatApi.createChatParticipant(PARTICIPANT_ID, handler);
    participant.iconPath = new vscode.ThemeIcon('checklist');
    return participant;
}

async function handleTurn(
    ctx: ParticipantContext,
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
    const state = ctx.capabilities.state();
    if (!state.available) {
        stream.markdown(
            `**Project Spec AI is unavailable.** ${state.message ?? ''}`,
        );
        return {};
    }
    const slash = (request.command || '').trim();
    if (!slash) {
        stream.markdown(helpMessage());
        return {};
    }
    const userPrompt = (request.prompt || '').trim();
    const explicitTarget = parseTargetFlag(userPrompt);
    const intent = intentForSlash(slash, explicitTarget?.type);
    if (!intent) {
        stream.markdown(`Unknown slash command \`/${slash}\`.\n\n${helpMessage()}`);
        return {};
    }
    const target = resolveTarget(intent, explicitTarget, userPrompt);
    if (!target) {
        stream.markdown(
            `\`/${slash}\` requires a target. Use \`--target <Type>\` (e.g. ` +
                `\`--target Hlr\`) and, where relevant, \`--id HLR-NNN\`, ` +
                `\`--section <n>\`, or \`--file <path>\`.`,
        );
        return {};
    }

    stream.progress(`Running ${intent.id}…`);
    const outcome = await ctx.aiClient.runIntent({
        intent: intent.id,
        target,
        userPrompt: userPrompt || `Run ${intent.id}.`,
        token,
    });
    return await renderOutcome(ctx, intent, target, outcome, userPrompt, stream);
}

async function renderOutcome(
    ctx: ParticipantContext,
    intent: IntentSpec,
    target: AiTarget,
    outcome: { result: AiRequestResult; rawResponse?: string; modelId?: string; pendingApply: boolean },
    userPrompt: string,
    stream: vscode.ChatResponseStream,
): Promise<vscode.ChatResult> {
    const { result, rawResponse, modelId, pendingApply } = outcome;
    switch (result.kind) {
        case 'applied': {
            stream.markdown(
                `**Applied** \`${intent.id}\` on \`${target.type}\`. ` +
                    `${describeWritten(result)}`,
            );
            return {};
        }
        case 'validated': {
            stream.markdown(
                `**Validated** \`${intent.id}\` on \`${target.type}\`. ` +
                    `Opening diff preview…`,
            );
            if (pendingApply && rawResponse) {
                const accepted = await showAiDiffPreview(ctx.preview, {
                    intent: intent.id,
                    label: target.type,
                    result,
                    summary: `Target: \`${target.type}\` ${
                        target.id ? `(${target.id})` : ''
                    }`,
                });
                if (accepted) {
                    const applied = await ctx.aiClient.applyAccepted({
                        intent: intent.id,
                        target,
                        userPrompt,
                        response: rawResponse,
                        retries: result.retries,
                        modelId,
                    });
                    stream.markdown(
                        `**Applied** \`${intent.id}\`. ${describeWritten(applied)}`,
                    );
                    await vscode.commands.executeCommand('projectXml.refresh');
                } else {
                    stream.markdown('_Cancelled — patch was not applied._');
                }
            }
            return {};
        }
        case 'rejected': {
            const failures = result.failures ?? [];
            stream.markdown(
                `**Rejected** \`${intent.id}\` after ${result.retries} retry(ies).` +
                    (failures.length
                        ? `\n\n${failures.map((f) => `- ${f}`).join('\n')}`
                        : ''),
            );
            return {};
        }
        case 'advisory': {
            const findings = result.advisory ?? [];
            if (findings.length === 0) {
                stream.markdown(`No advisory findings for \`${target.type}\`.`);
            } else {
                stream.markdown(
                    `Advisory findings for \`${target.type}\`:\n\n` +
                        findings.map((f) => `- ${JSON.stringify(f)}`).join('\n'),
                );
            }
            return {};
        }
        case 'draft_pvd': {
            stream.markdown(
                `**Drafted PVD section.** Review the proposed Markdown ` +
                    `below; copy into \`doc/PVD.md\` if you accept.\n\n---\n\n` +
                    (result.markdown ?? ''),
            );
            return {};
        }
        case 'no-model': {
            stream.markdown(
                'No language model is available. Install a chat model ' +
                    'extension (e.g. GitHub Copilot Chat) and try again.',
            );
            return {};
        }
        case 'prompt': {
            stream.markdown(
                'Prompt round-trip did not terminate; this is a bug.',
            );
            return {};
        }
        default: {
            stream.markdown(`Unhandled outcome kind: \`${result.kind}\``);
            return {};
        }
    }
}

function helpMessage(): string {
    const slashes = INTENTS.map((i) => `- \`/${i.slash}\` — ${i.label}`)
        .filter((line, idx, arr) => arr.indexOf(line) === idx)
        .join('\n');
    return (
        `**Project Spec AI**\n\nUse one of the slash commands below; ` +
        `pass \`--target <Type>\` (and optionally \`--id\`, \`--section\`, ` +
        `\`--file\`) so the AI knows which payload to act on.\n\n${slashes}`
    );
}

interface ExplicitTarget {
    type?: string;
    id?: string;
    section?: string;
    file?: string;
}

/** Parse `--target Hlr --id HLR-001 --section 1 --file path` flags. */
function parseTargetFlag(prompt: string): ExplicitTarget | undefined {
    const out: ExplicitTarget = {};
    const flagPattern = /--(target|id|section|file)\s+(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = flagPattern.exec(prompt)) !== null) {
        out[m[1] as keyof ExplicitTarget] = m[2];
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function resolveTarget(
    intent: IntentSpec,
    explicit: ExplicitTarget | undefined,
    _prompt: string,
): AiTarget | undefined {
    // `draft.pvd` is the only intent with no payload target.
    if (intent.kind === 'pvd') {
        return { type: 'Pvd', ...(explicit?.section ? { section: explicit.section } : {}) };
    }
    let type = explicit?.type;
    if (!type) {
        // Default to the intent's first declared target — covers the
        // `/draft-hlr`-only-targets-Hlr case without forcing the user
        // to type `--target Hlr`.
        type = intent.targets[0];
    }
    if (!type) {
        return undefined;
    }
    return {
        type,
        id: explicit?.id,
        section: explicit?.section,
        file: explicit?.file,
    };
}

function describeWritten(result: AiRequestResult): string {
    if (!result.patch || result.patch.length === 0) {
        return 'No write performed.';
    }
    const ops = result.patch.length;
    return `${ops} JSON-Patch operation(s) ${
        result.written ? 'applied' : 'staged'
    }.`;
}
