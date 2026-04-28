// TreeDataProvider for the "Project Spec" view. Renders the parsed
// project (from project_io.parse_to_json) as five top-level groups —
// HLRs, LLRs, Tests, SDD, STP — each annotated with a count.
//
// Tree items that map to a real XML element carry a `locator` payload
// so the Reveal in XML command can range them precisely. Items
// without a locator (group headers, empty placeholders) still render
// but cannot be revealed.

import * as vscode from 'vscode';
import {
    ParsedNode,
    ParsedProject,
    ParsedTrace,
    ProjectIoClient,
    UiHintEntry,
} from '../sidecar';
import { BadgeIndex } from '../util/badges';
import { applyHintsToNode } from '../util/hints';
import { getConfig, getProjectXmlPath } from '../util/paths';
import { decorateTooltips } from './coverageTooltips';

export interface RevealLocator {
    readonly tag: string;
    readonly attr?: string;   // defaults to "id"
    readonly value: string;
}

export class ProjectSpecNode extends vscode.TreeItem {
    /**
     * LLR-PSP-07: when set, double-click and the "Edit" context-menu
     * entry open the schema-driven popup edit dialog for this element.
     */
    editArgs: EditPayloadArgs | undefined;

    /** Document id (e.g. `"HLRs"`, `"SDD"`) for group nodes that map
     *  to a generated document, enabling "Render & Preview" from the
     *  context menu. */
    docId: string | undefined;

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

    /**
     * Phase 5b — mark this node as eligible for the AI tree
     * context-menu group (HLR-053). The package.json `when` clause
     * matches `viewItem =~ /aiTargetable/` so the group is hidden on
     * non-payload nodes (containers, placeholders, the STP root).
     */
    markAiTargetable(): void {
        const base = this.contextValue ?? '';
        if (!base.includes('aiTargetable')) {
            this.contextValue = base ? `${base} aiTargetable` : 'aiTargetable';
        }
    }

    /**
     * LLR-PSP-07: mark this leaf as editable via the popup dialog.
     * Stores the args for `projectXml.editPayload` and adds the
     * `editable` contextValue token so the "Edit" context-menu entry
     * appears. Does NOT set `TreeItem.command` — double-click is
     * handled by the `TreeView.onDidChangeSelection` listener in
     * `extension.ts` so that single-click selection (and therefore
     * right-click context menus) keeps working normally.
     */
    markEditable(args: EditPayloadArgs): void {
        this.editArgs = args;
        const base = this.contextValue ?? '';
        if (!base.includes('editable')) {
            this.contextValue = base ? `${base} editable` : 'editable';
        }
        // Single-click opens the popup edit dialog (standard VS Code
        // tree UX).  Right-click context menus are independent and
        // continue to work normally.
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

    /**
     * Slice E: install the badge index built from the most recent
     * lint result. Stored on the provider rather than passed through
     * every getChildren call so the lint and tree refresh paths can
     * stay independent. Callers should invoke `refresh()` afterwards
     * to redraw the tree.
     */
    setBadges(badges: BadgeIndex | undefined): void {
        this.badges = badges;
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
            const badges = badgesEnabled() ? this.badges : undefined;
            this.cached = buildTopLevel(project, badges);
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

function buildTopLevel(
    project: ParsedProject,
    badges: BadgeIndex | undefined,
): ProjectSpecNode[] {
    const hints = project._ui_hints_index;
    const topLevel = [
        buildHlrsNode(project, badges, locatorMeta(hints, 'Hlr', 'hlr', 'id')),
        buildLlrsNode(project, badges, locatorMeta(hints, 'Llr', 'llr', 'id')),
        buildTestsNode(project, locatorMeta(hints, 'Test', 'test', 'name')),
        buildSddNode(project, locatorMeta(hints, 'SddModule', 'module', 'path')),
        buildStpNode(project),
        ...buildGenericPayloadNodes(project),
    ];
    decorateAiTargetable(topLevel, hints);
    decorateTooltips(topLevel, project);
    return topLevel;
}

/**
 * Phase 5b (HLR-053): walk the built tree and mark every leaf whose
 * underlying XML tag has at least one applicable AI intent. Sources
 * the eligible tag set from `_ui_hints_index[*].ai_actions` so a new
 * payload kind that registers AI intents (via `tools/ai/registry.py`
 * + a `<ui:treeNode/>` annotation) automatically inherits the AI
 * tree context menu — no TS edit required.
 */
function decorateAiTargetable(
    roots: ProjectSpecNode[],
    hints: ParsedProject['_ui_hints_index'],
): void {
    if (!hints) {
        return;
    }
    const tagsWithAi = new Set<string>();
    for (const entry of Object.values(hints)) {
        if (entry.element && entry.ai_actions && entry.ai_actions.length > 0) {
            tagsWithAi.add(entry.element);
        }
    }
    if (tagsWithAi.size === 0) {
        return;
    }
    const stack: ProjectSpecNode[] = [...roots];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.locator && tagsWithAi.has(node.locator.tag)) {
            node.markAiTargetable();
        }
        if (node.children) {
            stack.push(...node.children);
        }
    }
}

/**
 * Slice H: resolve `(tag, idAttr)` for the four legacy typed builders
 * from `_ui_hints_index`, falling back to the original hard-coded
 * pair when the hints aren't available. Lets the schema rename or
 * re-attribute a payload (e.g. `<test>` keyed on something other than
 * `name`) without touching this file.
 */
interface LeafLocatorMeta {
    readonly tag: string;
    readonly idAttr: string;
}

/** Exported for tier-1 tests. */
export function locatorMeta(
    hints: ParsedProject['_ui_hints_index'],
    typeKey: string,
    fallbackTag: string,
    fallbackIdAttr: string,
): LeafLocatorMeta {
    const entry = hints?.[typeKey];
    const tag = entry?.element ?? fallbackTag;
    const idAttr = entry?.tree_node?.id_attr || fallbackIdAttr;
    return { tag, idAttr };
}

/**
 * LLR-PSP-07: arguments shape stored on editable leaves so that
 * double-click and the "Edit" context-menu entry can open
 * `projectXml.editPayload`.
 */
export interface EditPayloadArgs {
    readonly type: string;
    readonly basePath: string;
    readonly formData: Record<string, unknown>;
    readonly title: string;
}

function leafLocator(
    meta: LeafLocatorMeta,
    value: string,
): RevealLocator | undefined {
    if (!value) {
        return undefined;
    }
    return meta.idAttr === 'id'
        ? { tag: meta.tag, value }
        : { tag: meta.tag, attr: meta.idAttr, value };
}

/** Convert parsed traces to the shape RJSF expects ({target, ref}). */
function tracesForForm(
    traces: ParsedTrace[] | undefined,
): Array<{ target: string; ref: string }> {
    if (!traces || traces.length === 0) { return []; }
    return traces
        .filter((tr) => tr.target && tr.ref)
        .map((tr) => ({ target: tr.target!, ref: tr.ref! }));
}

/**
 * Phase 2.5b Slice E: schema-driven extension point.
 *
 * Walks `project._nodes` (the `Record<typeName, ParsedNode[]>` index
 * embedded by `parse_to_json` since Slice D) and emits one top-level
 * tree group for every type-key NOT already covered by the typed
 * builders above. This is the seam that makes adding a new payload
 * a zero-TS-edit operation: declare a `<xs:appinfo><ui:treeNode/>`
 * block on a new complex type in `tools/project.xsd`, render the
 * node's body in your Jinja template, and the Project Spec view
 * picks it up automatically.
 *
 * The legacy buildHlrsNode / buildLlrsNode / buildTestsNode /
 * buildSddNode / buildStpNode functions stay in place because they
 * preserve UX nesting (HLR sections, LLR function groups, test
 * files) that the generic walker can't recover from a flat node
 * list. Migrating those onto this seam is a follow-up slice.
 */
function buildGenericPayloadNodes(project: ParsedProject): ProjectSpecNode[] {
    const nodes = project._nodes ?? {};
    const hints = project._ui_hints_index ?? {};
    const out: ProjectSpecNode[] = [];
    // Stable order: type-keys sorted alphabetically.
    for (const key of Object.keys(nodes).sort()) {
        if (COVERED_TYPE_KEYS.has(key)) {
            continue;
        }
        const entry = hints[key];
        if (!entry || !entry.tree_node || !entry.element) {
            continue;
        }
        out.push(buildGenericGroup(key, entry, nodes[key] ?? []));
    }
    return out;
}

function buildGenericGroup(
    key: string,
    entry: UiHintEntry,
    parsedNodes: ParsedNode[],
): ProjectSpecNode {
    const tag = entry.element ?? key.toLowerCase();
    const idAttr = entry.tree_node?.id_attr ?? 'id';
    const labelTemplate = entry.tree_node?.label || `@${idAttr}`;
    const children = parsedNodes.map((n) => {
        const value = n.attrs[idAttr] ?? '';
        const leaf = new ProjectSpecNode(
            renderLabel(labelTemplate, n) || `(${tag})`,
            vscode.TreeItemCollapsibleState.None,
            undefined,
            value
                ? { tag, attr: idAttr, value }
                : undefined,
        );
        applyHintsToNode(leaf, n.ui ?? undefined);
        if (value && entry.form && entry.form.length > 0) {
            leaf.markEditable({
                type: key,
                basePath: `/${tag}[${idAttr}=${value}]`,
                formData: { ...n.attrs },
                title: `Edit ${value}`,
            });
        }
        return leaf;
    });
    const node = new ProjectSpecNode(
        `${key} (${parsedNodes.length})`,
        children.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        children,
    );
    node.iconPath = new vscode.ThemeIcon('symbol-misc');
    return node;
}

/**
 * Substitute `@<attr>` tokens in a `ui:treeNode/@label` template with
 * values from `node.attrs`. Unknown tokens collapse to empty string.
 * Trims redundant whitespace so a template like `"@id — @name"` with
 * no `name` attribute renders as just `"HLR-001"`, not `"HLR-001 — "`.
 */
function renderLabel(template: string, node: ParsedNode): string {
    const raw = template.replace(
        /@([A-Za-z_][\w-]*)/g,
        (_m, name: string) => node.attrs[name] ?? '',
    );
    return raw.replace(/\s+[—-]\s+(?=$|\s)/g, '').replace(/\s+/g, ' ').trim();
}

function badgesEnabled(): boolean {
    return getConfig().get<boolean>('showCoverageBadges', true);
}

function decorate(
    label: string,
    badge: string | undefined,
): string {
    return badge ? `${badge} ${label}` : label;
}

/** Exported for tier-1 tests. */
export const COVERED_TYPE_KEYS = new Set([
    'Hlr',
    'Llr',
    'Test',
    'SddModule',
]);

/** Exported for tier-1 tests. */
export function _buildGenericPayloadNodes(
    project: ParsedProject,
): ProjectSpecNode[] {
    return buildGenericPayloadNodes(project);
}

/** Exported for tier-1 tests. */
export function _renderLabel(template: string, node: ParsedNode): string {
    return renderLabel(template, node);
}

function buildHlrsNode(
    project: ParsedProject,
    badges: BadgeIndex | undefined,
    meta: LeafLocatorMeta,
): ProjectSpecNode {
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
                    (h) => {
                        const leaf = new ProjectSpecNode(
                            decorate(
                                `${h.id}${h.name ? ` ${h.name}` : ''}`,
                                badges?.badgeFor('hlr', h.id),
                            ),
                            vscode.TreeItemCollapsibleState.None,
                            undefined,
                            leafLocator(meta, h.id),
                        );
                        applyHintsToNode(leaf, h.ui);
                        if (h.id && sec.number) {
                            leaf.markEditable({
                                type: 'Hlr',
                                basePath: `/hlrs/section[number=${sec.number}]/hlr[id=${h.id}]`,
                                formData: { id: h.id, name: h.name ?? '', text: h.text ?? '', traces: tracesForForm(h.traces) },
                                title: `Edit ${h.id}`,
                            });
                        }
                        return leaf;
                    },
                ),
            );
        }),
    );
    node.iconPath = new vscode.ThemeIcon('symbol-namespace');
    node.contextValue = 'hlrsGroup';
    node.docId = 'HLRs';
    return node;
}

function buildLlrsNode(
    project: ParsedProject,
    badges: BadgeIndex | undefined,
    meta: LeafLocatorMeta,
): ProjectSpecNode {
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
                    (l) => {
                        const leaf = new ProjectSpecNode(
                            decorate(l.id, badges?.badgeFor('llr', l.id)),
                            vscode.TreeItemCollapsibleState.None,
                            undefined,
                            leafLocator(meta, l.id),
                        );
                        applyHintsToNode(leaf, l.ui);
                        if (l.id && g.number) {
                            leaf.markEditable({
                                type: 'Llr',
                                basePath: `/llrs/function[number=${g.number}]/llr[id=${l.id}]`,
                                formData: { id: l.id, text: l.text ?? '', traces: tracesForForm(l.traces) },
                                title: `Edit ${l.id}`,
                            });
                        }
                        return leaf;
                    },
                ),
            );
        }),
    );
    node.iconPath = new vscode.ThemeIcon('symbol-method');
    node.contextValue = 'llrsGroup';
    node.docId = 'LLRs';
    return node;
}

function buildTestsNode(
    project: ParsedProject,
    meta: LeafLocatorMeta,
): ProjectSpecNode {
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
                    (t) => {
                        const leaf = new ProjectSpecNode(
                            t.name,
                            vscode.TreeItemCollapsibleState.None,
                            undefined,
                            leafLocator(meta, t.name),
                        );
                        applyHintsToNode(leaf, t.ui);
                        if (t.name && f.path) {
                            leaf.markEditable({
                                type: 'Test',
                                basePath: `/tests/file[path=${f.path}]/test[name=${t.name}]`,
                                formData: { name: t.name, purpose: t.purpose ?? '', traces: tracesForForm(t.traces) },
                                title: `Edit ${t.name}`,
                            });
                        }
                        return leaf;
                    },
                ),
                { tag: 'file', attr: 'path', value: f.path },
            );
        }),
    );
    node.iconPath = new vscode.ThemeIcon('beaker');
    node.contextValue = 'testsGroup';
    node.docId = 'STP';
    return node;
}

function buildSddNode(
    project: ParsedProject,
    meta: LeafLocatorMeta,
): ProjectSpecNode {
    const modules = project.sdd?.modules ?? [];
    const node = new ProjectSpecNode(
        `SDD (${modules.length} modules)`,
        modules.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        modules.map(
            (m) => {
                const leaf = new ProjectSpecNode(
                    m.path ?? m.title ?? '(unnamed module)',
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    leafLocator(meta, m.path ?? ''),
                );
                applyHintsToNode(leaf, m.ui);
                if (m.path) {
                    leaf.markEditable({
                        type: 'SddModule',
                        basePath: `/sdd/modules/module[path=${m.path}]`,
                        formData: { path: m.path, title: m.title ?? '' },
                        title: `Edit ${m.path}`,
                    });
                }
                return leaf;
            },
        ),
    );
    node.iconPath = new vscode.ThemeIcon('book');
    node.contextValue = 'sddGroup';
    node.docId = 'SDD';
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
    node.docId = 'STP';
    return node;
}
