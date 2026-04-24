// TreeDataProvider for the "Project Spec" view. Renders the parsed
// project (from project_io.parse_to_json) as five top-level groups —
// HLRs, LLRs, Tests, SDD, STP — each annotated with a count.
//
// Tree items that map to a real XML element carry a `locator` payload
// so the Reveal in XML command can range them precisely. Items
// without a locator (group headers, empty placeholders) still render
// but cannot be revealed.

import * as vscode from 'vscode';
import { ProjectIoClient, ParsedProject } from '../sidecar';
import { getProjectXmlPath } from '../util/paths';

export interface RevealLocator {
    readonly tag: string;
    readonly attr?: string;   // defaults to "id"
    readonly value: string;
}

export class ProjectSpecNode extends vscode.TreeItem {
    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly children: ProjectSpecNode[] | undefined = undefined,
        public readonly locator: RevealLocator | undefined = undefined,
    ) {
        super(label, collapsibleState);
        if (locator) {
            this.contextValue = 'revealable';
        }
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

    constructor(
        private readonly client: ProjectIoClient,
        private readonly outputChannel: vscode.OutputChannel,
    ) {}

    refresh(): void {
        this.cached = undefined;
        this._onDidChange.fire();
    }

    getTreeItem(element: ProjectSpecNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ProjectSpecNode): Promise<ProjectSpecNode[]> {
        if (element) {
            return element.children ?? [];
        }
        if (this.cached) {
            return this.cached;
        }
        try {
            const xmlPath = getProjectXmlPath();
            const params = xmlPath ? { xml_path: xmlPath } : {};
            const project = await this.client.parseToJson(params);
            this.cached = buildTopLevel(project);
            return this.cached;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.outputChannel.appendLine(
                `[tree] parse_to_json failed: ${message}`,
            );
            const item = new ProjectSpecNode(
                `Failed to load Project.xml: ${message}`,
                vscode.TreeItemCollapsibleState.None,
            );
            item.iconPath = new vscode.ThemeIcon('error');
            return [item];
        }
    }
}

function buildTopLevel(project: ParsedProject): ProjectSpecNode[] {
    return [
        buildHlrsNode(project),
        buildLlrsNode(project),
        buildTestsNode(project),
        buildSddNode(project),
        buildStpNode(project),
    ];
}

function buildHlrsNode(project: ParsedProject): ProjectSpecNode {
    const sections = project.hlrs ?? [];
    const total = (project.flat_hlrs ?? []).length
        || sections.reduce((n, s) => n + (s.hlrs?.length ?? 0), 0);
    const node = new ProjectSpecNode(
        `HLRs (${total})`,
        total > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        sections.map((sec) => {
            const label = sec.number
                ? `§${sec.number} ${sec.title ?? ''}`.trim()
                : (sec.title ?? '(unnamed section)');
            const hlrs = sec.hlrs ?? [];
            return new ProjectSpecNode(
                `${label} (${hlrs.length})`,
                hlrs.length > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None,
                hlrs.map(
                    (h) =>
                        new ProjectSpecNode(
                            `${h.id}${h.name ? ` ${h.name}` : ''}`,
                            vscode.TreeItemCollapsibleState.None,
                            undefined,
                            { tag: 'hlr', value: h.id },
                        ),
                ),
            );
        }),
    );
    node.iconPath = new vscode.ThemeIcon('symbol-namespace');
    return node;
}

function buildLlrsNode(project: ParsedProject): ProjectSpecNode {
    const groups = project.llrs ?? [];
    const total = (project.flat_llrs ?? []).length
        || groups.reduce((n, g) => n + (g.llrs?.length ?? 0), 0);
    const node = new ProjectSpecNode(
        `LLRs (${total})`,
        total > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        groups.map((g) => {
            const llrs = g.llrs ?? [];
            const label = g.name ?? g.title ?? '(unnamed function)';
            return new ProjectSpecNode(
                `${label} (${llrs.length})`,
                llrs.length > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None,
                llrs.map(
                    (l) =>
                        new ProjectSpecNode(
                            l.id,
                            vscode.TreeItemCollapsibleState.None,
                            undefined,
                            { tag: 'llr', value: l.id },
                        ),
                ),
            );
        }),
    );
    node.iconPath = new vscode.ThemeIcon('symbol-method');
    return node;
}

function buildTestsNode(project: ParsedProject): ProjectSpecNode {
    const files = project.tests ?? [];
    const total = (project.flat_tests ?? []).length
        || files.reduce((n, f) => n + (f.tests?.length ?? 0), 0);
    const node = new ProjectSpecNode(
        `Tests (${total}, ${files.length} files)`,
        files.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        files.map((f) => {
            const tests = f.tests ?? [];
            return new ProjectSpecNode(
                `${f.path} (${tests.length})`,
                tests.length > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None,
                tests.map(
                    (t) =>
                        new ProjectSpecNode(
                            t.name,
                            vscode.TreeItemCollapsibleState.None,
                            undefined,
                            { tag: 'test', attr: 'name', value: t.name },
                        ),
                ),
                { tag: 'file', attr: 'path', value: f.path },
            );
        }),
    );
    node.iconPath = new vscode.ThemeIcon('beaker');
    return node;
}

function buildSddNode(project: ParsedProject): ProjectSpecNode {
    const modules = project.sdd?.modules ?? [];
    const node = new ProjectSpecNode(
        `SDD (${modules.length} modules)`,
        modules.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        modules.map(
            (m) =>
                new ProjectSpecNode(
                    m.path ?? m.title ?? '(unnamed module)',
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    m.path
                        ? { tag: 'module', attr: 'path', value: m.path }
                        : undefined,
                ),
        ),
    );
    node.iconPath = new vscode.ThemeIcon('book');
    return node;
}

function buildStpNode(project: ParsedProject): ProjectSpecNode {
    const present = project.stp != null;
    const node = new ProjectSpecNode(
        present ? 'STP' : 'STP (empty)',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        present ? { tag: 'stp', value: '' } : undefined,
    );
    if (present) {
        node.contextValue = 'revealable';
    }
    node.iconPath = new vscode.ThemeIcon('checklist');
    return node;
}
