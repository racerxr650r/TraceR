// TreeDataProvider — thin wrapper delegating to treeLogic.ts
// (humble object pattern, Phase 10).

import * as vscode from 'vscode';
import { ParsedProject, ProjectIoClient } from '../sidecar';
import { BadgeIndex } from '../util/badges';
import { applyHintsToNode } from '../util/hints';
import { getConfig, getProjectXmlPath } from '../util/paths';
import { decorateTooltips } from './coverageTooltips';
import {
    buildTopLevelDescriptors,
    COVERED_TYPE_KEYS as _COVERED_TYPE_KEYS,
    buildGenericPayloadDescriptors,
    locatorMeta as _locatorMeta,
    renderLabel,
    TreeNodeDescriptor,
} from './treeLogic';

// Re-export types and functions for backward compat.
export type {
    RevealLocator,
    EditPayloadArgs,
} from './treeLogic';
export { COVERED_TYPE_KEYS } from './treeLogic';
export { locatorMeta } from './treeLogic';
export type { RevealLocator as _RevealLocator } from './treeLogic';

// Tier-1 test shims.
export function _buildGenericPayloadNodes(project: ParsedProject): ProjectSpecNode[] {
    const descriptors = buildGenericPayloadDescriptors(project);
    return descriptors.map(descriptorToNode);
}
export function _renderLabel(template: string, node: import('../sidecar').ParsedNode): string {
    return renderLabel(template, node);
}

export class ProjectSpecNode extends vscode.TreeItem {
    editArgs: import('./treeLogic').EditPayloadArgs | undefined;
    docId: string | undefined;

    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly children: ProjectSpecNode[] | undefined = undefined,
        public readonly locator: import('./treeLogic').RevealLocator | undefined = undefined,
    ) {
        super(label, collapsibleState);
        if (locator) { this.contextValue = 'revealable'; }
    }

    markAiTargetable(): void {
        const base = this.contextValue ?? '';
        if (!base.includes('aiTargetable')) {
            this.contextValue = base ? `${base} aiTargetable` : 'aiTargetable';
        }
    }

    markEditable(args: import('./treeLogic').EditPayloadArgs): void {
        this.editArgs = args;
        const base = this.contextValue ?? '';
        if (!base.includes('editable')) {
            this.contextValue = base ? `${base} editable` : 'editable';
        }
        this.command = {
            command: 'projectXml.editPayload',
            title: 'Edit in Form…',
            arguments: [args],
        };
    }
}

export class ProjectSpecProvider
    implements vscode.TreeDataProvider<ProjectSpecNode>
{
    private readonly _onDidChange = new vscode.EventEmitter<
        ProjectSpecNode | undefined | null | void
    >();
    readonly onDidChangeTreeData = this._onDidChange.event;

    private cached: ProjectSpecNode[] | undefined;
    private badges: BadgeIndex | undefined;

    constructor(
        private readonly client: ProjectIoClient,
        private readonly outputChannel: vscode.OutputChannel,
    ) {}

    refresh(): void {
        this.cached = undefined;
        this._onDidChange.fire();
    }

    setBadges(badges: BadgeIndex | undefined): void {
        this.badges = badges;
        this.cached = undefined;
        this._onDidChange.fire();
    }

    getTreeItem(element: ProjectSpecNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ProjectSpecNode): Promise<ProjectSpecNode[]> {
        if (element) { return element.children ?? []; }
        if (this.cached) { return this.cached; }
        try {
            const xmlPath = getProjectXmlPath();
            if (!xmlPath) {
                const item = new ProjectSpecNode(
                    'Open a folder containing doc/Project.xml',
                    vscode.TreeItemCollapsibleState.None,
                );
                item.iconPath = new vscode.ThemeIcon('info');
                return [item];
            }
            const params = { xml_path: xmlPath };
            const project = await this.client.parseToJson(params);
            const badges = badgesEnabled() ? this.badges : undefined;
            const descriptors = buildTopLevelDescriptors(project, badges);
            this.cached = descriptors.map(descriptorToNode);
            decorateTooltips(this.cached, project);
            return this.cached;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.outputChannel.appendLine(`[tree] parse_to_json failed: ${message}`);
            const item = new ProjectSpecNode(
                `Failed to load Project.xml: ${message}`,
                vscode.TreeItemCollapsibleState.None,
            );
            item.iconPath = new vscode.ThemeIcon('error');
            return [item];
        }
    }
}

// ---------------------------------------------------------------------
// Descriptor → ProjectSpecNode conversion
// ---------------------------------------------------------------------

function descriptorToNode(d: TreeNodeDescriptor): ProjectSpecNode {
    const children = d.children?.map(descriptorToNode);
    const node = new ProjectSpecNode(
        d.label,
        d.collapsible
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        children,
        d.locator,
    );
    if (d.icon) {
        node.iconPath = new vscode.ThemeIcon(
            d.icon,
            d.iconColor ? new vscode.ThemeColor(d.iconColor) : undefined,
        );
    }
    if (d.contextValue) {
        node.contextValue = d.contextValue;
    }
    if (d.docId) {
        node.docId = d.docId;
    }
    if (d.editArgs) {
        node.markEditable(d.editArgs);
    }
    if (d.ui) {
        applyHintsToNode(node, d.ui);
    }
    if (d.aiTargetable) {
        node.markAiTargetable();
    }
    return node;
}

function badgesEnabled(): boolean {
    return getConfig().get<boolean>('showCoverageBadges', true);
}
