// Phase 5.5 — AI-assisted merge conflict resolution (HLR-063..069).
//
// Detects a Git MERGE state on doc/Project.xml, runs the deterministic
// Stage A merger (`tools/project_merge.py` via the sidecar's
// `merge_three_way` JSON-RPC method), and then walks any residual
// conflicts. Each residual is shown to the user with — when AI is
// available and `projectXml.merge.aiResidualResolution` is on — a
// "✨ AI suggestion" generated via the `merge.*` intents.
//
// The merge editor is the only commit surface: this resolver never
// writes to doc/Project.xml without an explicit accept gesture from
// the user. When the merge base is unavailable the Stage A merger
// refuses cleanly (HLR-034) and the resolver tells the user to fall
// back to manual conflict-marker resolution.

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { AiClient } from '../ai/AiClient';
import { AiCapabilityProvider } from '../ai/capabilities';
import {
    AiTarget,
    MergeConflict,
    MergeConflictKind,
    ProjectIoClient,
} from '../sidecar';
import {
    getConfig,
    getProjectFolder,
    getProjectXmlPath,
    getXsdPath,
} from '../util/paths';

interface ResidualOutcome {
    conflict: MergeConflict;
    /** AI-suggested resolution payload (intent-specific shape) when one
     *  was produced; null when the user declined or AI was unavailable. */
    aiPayload: Record<string, unknown> | null;
    /** Free-form rationale string the model returned (when present). */
    rationale: string | null;
    /** Intent id used to produce the suggestion (`merge.body`, etc.). */
    intent: string | null;
    /** Final user choice: `'ours' | 'theirs' | 'ai' | 'skip'`. */
    decision: 'ours' | 'theirs' | 'ai' | 'skip';
}

export interface MergeResolverDeps {
    sidecar: ProjectIoClient;
    capabilities: AiCapabilityProvider;
    aiClient: AiClient;
    output: vscode.OutputChannel;
}

/** Map a residual conflict kind to the AI intent that resolves it. */
function intentForConflict(kind: MergeConflictKind): string {
    switch (kind) {
        case 'body':
        case 'modify_delete':
            return 'merge.body';
        case 'trace':
            return 'merge.trace';
        case 'id_collision':
            return 'merge.rename';
        case 'schema_bump':
            return 'merge.schema_bump';
    }
}

/** Map a residual conflict to the AI target descriptor. */
function targetForConflict(conflict: MergeConflict): AiTarget {
    return {
        type: conflict.type || 'Hlr',
        id: conflict.key,
        extra: { container: conflict.container },
    };
}

/** True when Git reports this file as conflicted (UU / AA / DU / UD / etc.). */
async function isConflicted(uri: vscode.Uri): Promise<boolean> {
    try {
        const ext = vscode.extensions.getExtension('vscode.git');
        if (!ext) {
            return false;
        }
        const api = (ext.isActive ? ext.exports : await ext.activate())
            .getAPI(1);
        for (const repo of api.repositories) {
            const merge = repo.state.mergeChanges?.find(
                (c: { uri: vscode.Uri }) => c.uri.fsPath === uri.fsPath,
            );
            if (merge) {
                return true;
            }
        }
    } catch {
        // git extension absent → fall through to false
    }
    return false;
}

/** Run `git show :N:<relPath>` for a stage; returns null when missing. */
async function gitShowStage(
    cwd: string,
    relPath: string,
    stage: 1 | 2 | 3,
): Promise<string | null> {
    const { spawn } = await import('child_process');
    return new Promise((resolve) => {
        const proc = spawn('git', ['show', `:${stage}:${relPath}`], {
            cwd, stdio: ['ignore', 'pipe', 'pipe'],
        });
        const chunks: Buffer[] = [];
        proc.stdout.on('data', (c) => chunks.push(c));
        proc.on('error', () => resolve(null));
        proc.on('exit', (code) => {
            if (code !== 0) {
                resolve(null);
                return;
            }
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
    });
}

function sha1(input: string | null): string {
    if (input == null) {
        return 'null';
    }
    return crypto.createHash('sha1').update(input).digest('hex').slice(0, 12);
}

async function appendProvenance(
    folderFs: string,
    record: Record<string, unknown>,
): Promise<void> {
    const dir = path.join(folderFs, '.edit_doc');
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(
        path.join(dir, 'ai_history.jsonl'),
        JSON.stringify(record) + '\n',
        'utf8',
    );
}

function summariseConflict(c: MergeConflict): string {
    const note = c.note ? ` — ${c.note}` : '';
    return `${c.kind} on ${c.type} \`${c.key}\`${note}`;
}

/** Whether AI residual resolution is currently allowed (HLR-034 gate). */
export function aiResidualResolutionEnabled(
    capabilities: AiCapabilityProvider,
): boolean {
    if (!capabilities.state().available) {
        return false;
    }
    return getConfig().get<boolean>('merge.aiResidualResolution', true);
}

export class MergeConflictResolver {
    constructor(private readonly deps: MergeResolverDeps) {}

    /**
     * Entry point used by the `projectXml.resolveMergeConflicts`
     * command and the `/resolve-conflicts` slash command.
     */
    async resolve(): Promise<void> {
        const xmlPath = getProjectXmlPath();
        const folder = getProjectFolder();
        if (!xmlPath || !folder) {
            vscode.window.showWarningMessage(
                'Project Spec: no Project.xml found in the open workspace.',
            );
            return;
        }
        if (!getConfig().get<boolean>('merge.enabled', true)) {
            vscode.window.showInformationMessage(
                'Project Spec merge is disabled (projectXml.merge.enabled).',
            );
            return;
        }
        const uri = vscode.Uri.file(xmlPath);
        if (!(await isConflicted(uri))) {
            vscode.window.showInformationMessage(
                'Project Spec: doc/Project.xml is not in a Git merge state.',
            );
            return;
        }
        const folderFs = folder.uri.fsPath;
        const relPath = path.relative(folderFs, xmlPath);
        const [base, ours, theirs] = await Promise.all([
            gitShowStage(folderFs, relPath, 1),
            gitShowStage(folderFs, relPath, 2),
            gitShowStage(folderFs, relPath, 3),
        ]);
        if (!ours || !theirs) {
            vscode.window.showErrorMessage(
                'Project Spec: could not read ours/theirs stages from Git.',
            );
            return;
        }
        const xsdPath = getXsdPath();
        let mergeResult;
        try {
            mergeResult = await this.deps.sidecar.mergeThreeWay({
                base, ours, theirs, xsd_path: xsdPath,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(
                `Project Spec merge failed: ${msg}`,
            );
            return;
        }
        if (mergeResult.refused) {
            vscode.window.showWarningMessage(
                `Project Spec merge refused: ${mergeResult.refusal ?? 'unknown reason'}. ` +
                'Falling back to manual conflict-marker resolution.',
            );
            return;
        }

        const residuals: ResidualOutcome[] = [];
        let mergedXml = mergeResult.merged_xml;
        const aiOn = aiResidualResolutionEnabled(this.deps.capabilities);

        for (const conflict of mergeResult.residual_conflicts) {
            const outcome = await this.handleResidual(
                conflict, mergedXml, aiOn, folderFs,
            );
            residuals.push(outcome);
            if (outcome.decision === 'ai' && outcome.aiPayload) {
                try {
                    const sub = await this.deps.sidecar.applyMergeResolution({
                        merged_xml: mergedXml,
                        conflict,
                        resolution: outcome.aiPayload,
                    });
                    mergedXml = sub.merged_xml;
                } catch (err) {
                    this.deps.output.appendLine(
                        `[merge] apply_resolution failed for ${conflict.key}: ${
                            err instanceof Error ? err.message : String(err)
                        }`,
                    );
                }
            }
        }

        await this.openMergeEditor(uri, base, ours, theirs, mergedXml,
            mergeResult.residual_conflicts.length, mergeResult.auto_resolved,
            residuals);
    }

    private async handleResidual(
        conflict: MergeConflict,
        _mergedXml: string,
        aiOn: boolean,
        folderFs: string,
    ): Promise<ResidualOutcome> {
        if (!aiOn) {
            return {
                conflict, aiPayload: null, rationale: null,
                intent: null, decision: 'skip',
            };
        }
        const intent = intentForConflict(conflict.kind);
        const target = targetForConflict(conflict);
        const userPrompt = renderConflictPrompt(conflict);
        try {
            const outcome = await this.deps.aiClient.runIntent({
                intent, target, userPrompt, autoApply: true,
            });
            const r = outcome.result;
            if (r.kind !== 'merge_resolved' || !r.response) {
                return {
                    conflict, aiPayload: null, rationale: null,
                    intent, decision: 'skip',
                };
            }
            const payload = r.response as Record<string, unknown>;
            const rationale = typeof payload.rationale === 'string'
                ? payload.rationale : null;
            await appendProvenance(folderFs, {
                kind: 'merge.suggestion',
                intent,
                conflict_kind: conflict.kind,
                conflict_key: conflict.key,
                base_sha1: sha1(conflict.base),
                ours_sha1: sha1(conflict.ours),
                theirs_sha1: sha1(conflict.theirs),
                rationale,
                model: outcome.modelId ?? null,
                ts: new Date().toISOString(),
            });
            return {
                conflict, aiPayload: payload, rationale,
                intent, decision: 'ai',
            };
        } catch (err) {
            this.deps.output.appendLine(
                `[merge] AI suggestion failed for ${conflict.key}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return {
                conflict, aiPayload: null, rationale: null,
                intent, decision: 'skip',
            };
        }
    }

    /**
     * Show the merger's output to the user. We write `merged_xml` to a
     * scratch file and open it side-by-side with the conflicted file
     * so the user can review and copy in. Falls back to a notification
     * when the merge editor command surface is unavailable.
     */
    private async openMergeEditor(
        targetUri: vscode.Uri,
        base: string | null,
        _ours: string | null,
        _theirs: string | null,
        mergedXml: string,
        residualCount: number,
        autoResolved: number,
        outcomes: ResidualOutcome[],
    ): Promise<void> {
        const scratchUri = targetUri.with({
            scheme: 'file',
            path: targetUri.path + '.tracer-merge.xml',
        });
        await fs.writeFile(scratchUri.fsPath, mergedXml, 'utf8');
        const summary = outcomes.map((o) => {
            const tag = o.decision === 'ai'
                ? '✨ AI suggestion'
                : (o.decision === 'skip' ? '⚠ unresolved' : o.decision);
            const rat = o.rationale ? ` — ${o.rationale}` : '';
            return `  - ${summariseConflict(o.conflict)} → ${tag}${rat}`;
        }).join('\n');
        this.deps.output.appendLine(
            `[merge] auto-resolved=${autoResolved} residual=${residualCount}\n${summary}`,
        );
        const action = await vscode.window.showInformationMessage(
            `Project Spec merge: ${autoResolved} auto-resolved, ` +
                `${residualCount} residual conflicts. Merged candidate ` +
                `written to ${path.basename(scratchUri.fsPath)}.`,
            'Open candidate', 'Diff vs. ours', 'Show log',
        );
        if (action === 'Open candidate') {
            const doc = await vscode.workspace.openTextDocument(scratchUri);
            await vscode.window.showTextDocument(doc);
        } else if (action === 'Diff vs. ours') {
            await vscode.commands.executeCommand(
                'vscode.diff', targetUri, scratchUri,
                'Project.xml ↔ AI-assisted merge candidate',
            );
        } else if (action === 'Show log') {
            this.deps.output.show();
        }
        if (base == null || base.length === 0) {
            this.deps.output.appendLine(
                '[merge] note: Git merge base was empty; merger may have refused.',
            );
        }
    }
}

/** Build the per-region user prompt fed to the merge.* intents. */
function renderConflictPrompt(c: MergeConflict): string {
    const sections: string[] = [];
    sections.push(`Conflict kind: ${c.kind}`);
    sections.push(`Container: ${c.container}`);
    sections.push(`Key: ${c.key}`);
    if (c.note) {
        sections.push(`Note: ${c.note}`);
    }
    if (c.base) {
        sections.push(`--- BASE ---\n${c.base}`);
    }
    if (c.ours) {
        sections.push(`--- OURS ---\n${c.ours}`);
    }
    if (c.theirs) {
        sections.push(`--- THEIRS ---\n${c.theirs}`);
    }
    if (c.rename_to) {
        sections.push(`Suggested rename: ${c.rename_to}`);
    }
    return sections.join('\n\n');
}
