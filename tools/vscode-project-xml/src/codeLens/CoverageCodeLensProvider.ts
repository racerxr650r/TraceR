// CodeLensProvider — thin wrapper delegating to coverageLensLogic.ts
// (humble object pattern, Phase 10).

import * as vscode from 'vscode';
import { ParsedProject, ProjectIoClient } from '../sidecar';
import { getProjectXmlPath } from '../util/paths';
import {
    buildIndex,
    buildElementIdRegex,
    computeLensDescriptors,
    CoverageIndex,
    getLensTargets,
    matchAll,
    RELATED_DISPATCH,
    RelatedItem,
    REVEAL_COMMAND,
} from './coverageLensLogic';

// Re-export for backward compat (existing tests + extension.ts).
export { PICK_RELATED_COMMAND, getLensTargets } from './coverageLensLogic';
export { RELATED_DISPATCH as _RELATED_DISPATCH } from './coverageLensLogic';
export { SUPPORTED_LENS_KINDS as _SUPPORTED_LENS_KINDS } from './coverageLensLogic';

export class CoverageCodeLensProvider
    implements vscode.CodeLensProvider, vscode.Disposable
{
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChange.event;

    private cachedProject: ParsedProject | undefined;
    private cachedIndex: CoverageIndex | undefined;
    private inflight: Promise<ParsedProject> | undefined;

    constructor(
        private readonly client: ProjectIoClient,
        private readonly outputChannel: vscode.OutputChannel,
    ) {}

    refresh(): void {
        this.cachedProject = undefined;
        this.cachedIndex = undefined;
        this._onDidChange.fire();
    }

    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): Promise<vscode.CodeLens[]> {
        if (!isProjectXml(document)) { return []; }
        let project: ParsedProject;
        try {
            project = await this.ensureProject();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.outputChannel.appendLine(`[codelens] parse_to_json failed: ${message}`);
            return [];
        }
        if (token.isCancellationRequested) { return []; }
        const index = this.cachedIndex ??= buildIndex(project);
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();

        for (const target of getLensTargets(project._ui_hints_index)) {
            const handler = RELATED_DISPATCH[target.element];
            if (!handler) { continue; }
            const regex = buildElementIdRegex(target.element, target.idAttr);
            for (const match of matchAll(text, regex)) {
                const range = rangeAt(document, match.index);
                const value = match[1];
                const related = handler(value, index);
                const descriptors = computeLensDescriptors(
                    target.summary(related),
                    `${target.label} ${value}`,
                    related,
                );
                for (const d of descriptors) {
                    lenses.push(new vscode.CodeLens(range, {
                        title: d.title,
                        command: d.command,
                        tooltip: d.tooltip,
                        arguments: d.arguments,
                    }));
                }
            }
        }
        return lenses;
    }

    private async ensureProject(): Promise<ParsedProject> {
        if (this.cachedProject) { return this.cachedProject; }
        if (this.inflight) { return this.inflight; }
        const xmlPath = getProjectXmlPath();
        const params = xmlPath ? { xml_path: xmlPath } : {};
        this.inflight = this.client.parseToJson(params)
            .then((p) => {
                this.cachedProject = p;
                this.cachedIndex = undefined;
                return p;
            })
            .finally(() => { this.inflight = undefined; });
        return this.inflight;
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}

// ---------------------------------------------------------------------
// Picker command (VS Code API — stays in the provider)
// ---------------------------------------------------------------------

interface PickRelatedArg {
    readonly title: string;
    readonly items: RelatedItem[];
}

export async function pickRelatedAndReveal(arg: PickRelatedArg | undefined): Promise<void> {
    if (!arg || !arg.items || arg.items.length === 0) { return; }
    const items = arg.items.map((it) => ({
        label: it.label,
        description: it.description,
        locator: it.locator,
    }));
    const pick = await vscode.window.showQuickPick(items, {
        title: `Related to ${arg.title}`,
        placeHolder: 'Choose an element to reveal in Project.xml',
    });
    if (!pick) { return; }
    await vscode.commands.executeCommand(REVEAL_COMMAND, pick.locator);
}

// ---------------------------------------------------------------------
// Helpers (VS Code API — stays in the provider)
// ---------------------------------------------------------------------

function isProjectXml(doc: vscode.TextDocument): boolean {
    const xmlPath = getProjectXmlPath();
    return !!xmlPath && doc.uri.fsPath === xmlPath;
}

function rangeAt(doc: vscode.TextDocument, offset: number): vscode.Range {
    const pos = doc.positionAt(offset);
    return new vscode.Range(pos.line, 0, pos.line, 0);
}
