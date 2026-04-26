// Phase 5b — Schema-driven AI tree context-menu (HLR-053).
//
// The Project Spec tree exposes one context-menu group per AI intent
// that targets the node's complex type. The list of intents is
// projected from `ui_hints_index.aiActions` (computed by the Python
// sidecar from `tools/ai/registry.py`), so adding a new payload kind
// with a `<ui:treeNode/>` annotation automatically picks up the
// applicable AI surface — no TS edits required.
//
// `package.json` declares one *generic* command,
// `projectXml.ai.runOnTreeItem`, that takes the tree node as its
// argument. The single command shows a Quick Pick when the node has
// more than one applicable intent (the common case for HLRs/LLRs);
// for nodes with exactly one intent it skips the picker. This keeps
// the menu schema closed (one command id) while letting the visible
// list grow with the registry.

import * as vscode from 'vscode';
import { AiClient } from './AiClient';
import { AiCapabilityProvider } from './capabilities';
import { AiPreviewProvider, showAiDiffPreview } from './diffPreview';
import { intentsForActions, IntentSpec } from './intents';
import {
    AiRequestResult,
    AiTarget,
    ProjectIoClient,
    UiHintsIndex,
} from '../sidecar';
import { ProjectSpecNode } from '../treeView/ProjectSpecProvider';
import { getProjectXmlPath } from '../util/paths';

export const AI_RUN_COMMAND = 'projectXml.ai.runOnTreeItem';

export interface TreeMenuContext {
    capabilities: AiCapabilityProvider;
    aiClient: AiClient;
    sidecar: ProjectIoClient;
    preview: AiPreviewProvider;
    output: vscode.OutputChannel;
}

/**
 * Register the single generic command that the tree menu invokes for
 * AI actions. The command rebuilds the applicable intents on every
 * invocation by re-reading `ui_hints_index` so a freshly added schema
 * type is picked up without a tree refresh.
 */
export function registerAiTreeCommands(
    context: vscode.ExtensionContext,
    ctx: TreeMenuContext,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(AI_RUN_COMMAND, (node: ProjectSpecNode | undefined) =>
            runOnTreeItem(ctx, node),
        ),
    );
}

async function runOnTreeItem(
    ctx: TreeMenuContext,
    node: ProjectSpecNode | undefined,
): Promise<void> {
    if (!node) {
        vscode.window.showWarningMessage(
            'Project Spec AI: select a tree item first.',
        );
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
    const hints = await fetchHints(ctx.sidecar);
    const target = treeItemToTarget(node, hints);
    if (!target) {
        vscode.window.showWarningMessage(
            'Project Spec AI: this tree item has no AI-targetable payload.',
        );
        return;
    }
    const actions = hints?.[target.type]?.ai_actions ?? [];
    const intents = intentsForActions(actions);
    if (intents.length === 0) {
        vscode.window.showInformationMessage(
            `Project Spec AI: no intents target \`${target.type}\`.`,
        );
        return;
    }
    const intent = await pickIntent(intents);
    if (!intent) {
        return;
    }
    const userPrompt = await vscode.window.showInputBox({
        title: intent.label,
        prompt: `Describe what to ${intent.id} for ${target.type}${
            target.id ? ` ${target.id}` : ''
        }`,
        ignoreFocusOut: true,
    });
    if (userPrompt === undefined) {
        return; // cancelled
    }
    await runIntentInteractive(ctx, intent, target, userPrompt || `Run ${intent.id}.`);
}

async function pickIntent(intents: IntentSpec[]): Promise<IntentSpec | undefined> {
    if (intents.length === 1) {
        return intents[0];
    }
    const items = intents.map((i) => ({
        label: i.label,
        description: i.id,
        intent: i,
    }));
    const picked = await vscode.window.showQuickPick(items, {
        title: 'Project Spec AI',
        placeHolder: 'Pick an AI action',
    });
    return picked?.intent;
}

async function runIntentInteractive(
    ctx: TreeMenuContext,
    intent: IntentSpec,
    target: AiTarget,
    userPrompt: string,
): Promise<void> {
    const outcome = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Project Spec AI — ${intent.label}`,
            cancellable: true,
        },
        (_progress, token) =>
            ctx.aiClient.runIntent({
                intent: intent.id,
                target,
                userPrompt,
                token,
            }),
    );
    await renderInteractiveOutcome(ctx, intent, target, outcome, userPrompt);
}

async function renderInteractiveOutcome(
    ctx: TreeMenuContext,
    intent: IntentSpec,
    target: AiTarget,
    outcome: { result: AiRequestResult; rawResponse?: string; modelId?: string; pendingApply: boolean },
    userPrompt: string,
): Promise<void> {
    const { result, rawResponse, modelId, pendingApply } = outcome;
    switch (result.kind) {
        case 'applied':
            vscode.window.showInformationMessage(
                `Applied ${intent.id} on ${target.type}.`,
            );
            await vscode.commands.executeCommand('projectXml.refresh');
            return;
        case 'validated': {
            if (!pendingApply || !rawResponse) {
                vscode.window.showInformationMessage(
                    `Validated ${intent.id}; nothing to apply.`,
                );
                return;
            }
            const accepted = await showAiDiffPreview(ctx.preview, {
                intent: intent.id,
                label: target.type,
                result,
                summary: `Target: \`${target.type}\` ${
                    target.id ? `(${target.id})` : ''
                }`,
            });
            if (!accepted) {
                vscode.window.showInformationMessage(
                    `Cancelled ${intent.id}; no changes written.`,
                );
                return;
            }
            await ctx.aiClient.applyAccepted({
                intent: intent.id,
                target,
                userPrompt,
                response: rawResponse,
                retries: result.retries,
                modelId,
            });
            await vscode.commands.executeCommand('projectXml.refresh');
            vscode.window.showInformationMessage(
                `Applied ${intent.id} on ${target.type}.`,
            );
            return;
        }
        case 'rejected':
            vscode.window.showWarningMessage(
                `${intent.id} rejected after ${result.retries} retry(ies). ` +
                    `${(result.failures ?? []).join('; ')}`,
            );
            return;
        case 'advisory': {
            const findings = result.advisory ?? [];
            const body = [
                `# ${intent.label}`,
                ``,
                `Target: \`${target.type}\``,
                ``,
                ...findings.map((f) => `- ${JSON.stringify(f)}`),
            ].join('\n');
            const uri = ctx.preview.register(
                `${intent.id}.advisory.${target.type}`,
                body,
            );
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: true });
            return;
        }
        case 'draft_pvd': {
            const body = `# Draft PVD\n\n${result.markdown ?? ''}`;
            const uri = ctx.preview.register(`${intent.id}.pvd`, body);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: true });
            return;
        }
        case 'no-model':
            vscode.window.showWarningMessage(
                'Project Spec AI: no language model is available.',
            );
            return;
        default:
            vscode.window.showInformationMessage(
                `Project Spec AI: ${intent.id} returned ${result.kind}.`,
            );
            return;
    }
}

async function fetchHints(
    sidecar: ProjectIoClient,
): Promise<UiHintsIndex | undefined> {
    try {
        const xmlPath = getProjectXmlPath();
        const params = xmlPath ? { xml_path: xmlPath } : {};
        const resp = await sidecar.uiHintsIndex(params);
        return resp.ui_hints_index;
    } catch {
        return undefined;
    }
}

function treeItemToTarget(
    node: ProjectSpecNode,
    hints: UiHintsIndex | undefined,
): AiTarget | undefined {
    const loc = node.locator;
    if (!loc) {
        return undefined;
    }
    // Reverse-lookup the schema's complex type for this XML tag so the
    // AI surface inherits any new payload added under a `<ui:treeNode/>`
    // hint without a TS edit.
    const type = lookupTypeForTag(hints, loc.tag);
    if (!type) {
        return undefined;
    }
    return { type, id: loc.value };
}

function lookupTypeForTag(
    hints: UiHintsIndex | undefined,
    tag: string,
): string | undefined {
    if (!hints) {
        return TAG_TO_TYPE[tag];
    }
    for (const [type, entry] of Object.entries(hints)) {
        if (entry.element === tag) {
            return type;
        }
    }
    return TAG_TO_TYPE[tag];
}

/** Last-resort mapping for the four legacy typed builders when the
 *  sidecar hasn't returned a hints index yet. The schema-driven branch
 *  above takes precedence as soon as hints are available. */
const TAG_TO_TYPE: Record<string, string> = {
    hlr: 'Hlr',
    llr: 'Llr',
    test: 'Test',
    module: 'SddModule',
};
