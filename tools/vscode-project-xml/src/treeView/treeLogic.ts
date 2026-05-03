// Pure tree-structure and label logic extracted from
// ProjectSpecProvider.ts (humble object pattern, Phase 10).
//
// Free of vscode imports; testable in a plain Node process.

import {
    ParsedNode,
    ParsedProject,
    ParsedTrace,
    UiHintEntry,
    UiHints,
} from '../sidecar';
import { BadgeIndex } from '../util/badges';

// ---------------------------------------------------------------------
// Types re-exported by ProjectSpecProvider for backward compat
// ---------------------------------------------------------------------

export interface RevealLocator {
    readonly tag: string;
    readonly attr?: string;
    readonly value: string;
}

export interface EditPayloadArgs {
    readonly type: string;
    readonly basePath: string;
    readonly formData: Record<string, unknown>;
    readonly title: string;
}

export interface LeafLocatorMeta {
    readonly tag: string;
    readonly idAttr: string;
}

// ---------------------------------------------------------------------
// Tree node descriptor (pure data, no vscode.TreeItem)
// ---------------------------------------------------------------------

export interface TreeNodeDescriptor {
    label: string;
    collapsible: boolean;
    children?: TreeNodeDescriptor[];
    locator?: RevealLocator;
    editArgs?: EditPayloadArgs;
    icon?: string;
    iconColor?: string;
    contextValue?: string;
    docId?: string;
    ui?: UiHints | null;
    aiTargetable?: boolean;
}

// ---------------------------------------------------------------------
// Label / badge helpers
// ---------------------------------------------------------------------

export function decorate(label: string, badge: string | undefined): string {
    return badge ? `${badge} ${label}` : label;
}

export function renderLabel(template: string, node: ParsedNode): string {
    const raw = template.replace(
        /@([A-Za-z_][\w-]*)/g,
        (_m, name: string) => node.attrs[name] ?? '',
    );
    return raw.replace(/\s+[\u2014-]\s+(?=$|\s)/g, '').replace(/\s+/g, ' ').trim();
}

export type SeverityLevel = 'error' | 'warning' | undefined;

export function labelSeverity(label: string): SeverityLevel {
    if (label.startsWith('\u274c')) { return 'error'; }
    if (label.startsWith('\u26a0')) { return 'warning'; }
    return undefined;
}

export function worstSeverity(items: Array<{ label: string; iconId?: string }>): SeverityLevel {
    let hasWarning = false;
    for (const item of items) {
        if (item.label.startsWith('\u274c') || item.iconId === 'error') { return 'error'; }
        if (item.label.startsWith('\u26a0') || item.iconId === 'warning') { hasWarning = true; }
    }
    return hasWarning ? 'warning' : undefined;
}

// ---------------------------------------------------------------------
// Locator / trace helpers
// ---------------------------------------------------------------------

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

export function leafLocator(
    meta: LeafLocatorMeta,
    value: string,
): RevealLocator | undefined {
    if (!value) { return undefined; }
    return meta.idAttr === 'id'
        ? { tag: meta.tag, value }
        : { tag: meta.tag, attr: meta.idAttr, value };
}

export function tracesForForm(
    traces: ParsedTrace[] | undefined,
): Array<{ target: string; ref: string }> {
    if (!traces || traces.length === 0) { return []; }
    return traces
        .filter((tr) => tr.target && tr.ref)
        .map((tr) => ({ target: tr.target!, ref: tr.ref! }));
}

// ---------------------------------------------------------------------
// Set of type-keys handled by the typed builders (not the generic path)
// ---------------------------------------------------------------------

export const COVERED_TYPE_KEYS = new Set([
    'Hlr',
    'Llr',
    'Test',
    'SddModule',
]);

// ---------------------------------------------------------------------
// Top-level tree descriptor builders
// ---------------------------------------------------------------------

export function buildTopLevelDescriptors(
    project: ParsedProject,
    badges: BadgeIndex | undefined,
): TreeNodeDescriptor[] {
    const hints = project._ui_hints_index;
    const topLevel = [
        buildHlrsDescriptor(project, badges, locatorMeta(hints, 'Hlr', 'hlr', 'id')),
        buildLlrsDescriptor(project, badges, locatorMeta(hints, 'Llr', 'llr', 'id')),
        buildTestsDescriptor(project, locatorMeta(hints, 'Test', 'test', 'name')),
        buildSddDescriptor(project, locatorMeta(hints, 'SddModule', 'module', 'path')),
        buildStpDescriptor(project),
        ...buildGenericPayloadDescriptors(project),
    ];
    propagateBadgeSeverity(topLevel);
    decorateAiTargetable(topLevel, hints);
    return topLevel;
}

function buildHlrsDescriptor(
    project: ParsedProject,
    badges: BadgeIndex | undefined,
    meta: LeafLocatorMeta,
): TreeNodeDescriptor {
    const sections = project.hlrs ?? [];
    const total = (project.flat_hlrs ?? []).length
        || sections.reduce((n, s) => n + (s.hlrs?.length ?? 0), 0);
    return {
        label: `HLRs (${total})`,
        collapsible: total > 0,
        icon: 'symbol-namespace',
        contextValue: 'hlrsGroup',
        docId: 'HLRs',
        children: sections.map((sec) => {
            const label = sec.number
                ? `\u00a7${sec.number} ${sec.title ?? ''}`.trim()
                : (sec.title ?? '(unnamed section)');
            const hlrs = sec.hlrs ?? [];
            return {
                label: `${label} (${hlrs.length})`,
                collapsible: hlrs.length > 0,
                children: hlrs.map((h) => ({
                    label: decorate(
                        `${h.id}${h.name ? ` ${h.name}` : ''}`,
                        badges?.badgeFor('hlr', h.id),
                    ),
                    collapsible: false,
                    locator: leafLocator(meta, h.id),
                    ui: h.ui,
                    editArgs: (h.id && sec.number) ? {
                        type: 'Hlr',
                        basePath: `/hlrs/section[number=${sec.number}]/hlr[id=${h.id}]`,
                        formData: { id: h.id, name: h.name ?? '', text: h.text ?? '', traces: tracesForForm(h.traces) },
                        title: `Edit ${h.id}`,
                    } : undefined,
                } as TreeNodeDescriptor)),
            } as TreeNodeDescriptor;
        }),
    };
}

function buildLlrsDescriptor(
    project: ParsedProject,
    badges: BadgeIndex | undefined,
    meta: LeafLocatorMeta,
): TreeNodeDescriptor {
    const groups = project.llrs ?? [];
    const total = (project.flat_llrs ?? []).length
        || groups.reduce((n, g) => n + (g.llrs?.length ?? 0), 0);
    return {
        label: `LLRs (${total})`,
        collapsible: total > 0,
        icon: 'symbol-method',
        contextValue: 'llrsGroup',
        docId: 'LLRs',
        children: groups.map((g) => {
            const llrs = g.llrs ?? [];
            const label = g.name ?? g.title ?? '(unnamed function)';
            return {
                label: `${label} (${llrs.length})`,
                collapsible: llrs.length > 0,
                children: llrs.map((l) => ({
                    label: decorate(l.id, badges?.badgeFor('llr', l.id)),
                    collapsible: false,
                    locator: leafLocator(meta, l.id),
                    ui: l.ui,
                    editArgs: (l.id && g.number) ? {
                        type: 'Llr',
                        basePath: `/llrs/function[number=${g.number}]/llr[id=${l.id}]`,
                        formData: { id: l.id, text: l.text ?? '', traces: tracesForForm(l.traces) },
                        title: `Edit ${l.id}`,
                    } : undefined,
                } as TreeNodeDescriptor)),
            } as TreeNodeDescriptor;
        }),
    };
}

function buildTestsDescriptor(
    project: ParsedProject,
    meta: LeafLocatorMeta,
): TreeNodeDescriptor {
    const files = project.tests ?? [];
    const total = (project.flat_tests ?? []).length
        || files.reduce((n, f) => n + (f.tests?.length ?? 0), 0);
    return {
        label: `Tests (${total}, ${files.length} files)`,
        collapsible: files.length > 0,
        icon: 'beaker',
        contextValue: 'testsGroup',
        docId: 'STP',
        children: files.map((f) => {
            const tests = f.tests ?? [];
            return {
                label: `${f.path} (${tests.length})`,
                collapsible: tests.length > 0,
                locator: { tag: 'file', attr: 'path', value: f.path },
                children: tests.map((t) => ({
                    label: t.name,
                    collapsible: false,
                    locator: leafLocator(meta, t.name),
                    ui: t.ui,
                    editArgs: (t.name && f.path) ? {
                        type: 'Test',
                        basePath: `/tests/file[path=${f.path}]/test[name=${t.name}]`,
                        formData: { name: t.name, purpose: t.purpose ?? '', traces: tracesForForm(t.traces) },
                        title: `Edit ${t.name}`,
                    } : undefined,
                } as TreeNodeDescriptor)),
            } as TreeNodeDescriptor;
        }),
    };
}

function buildSddDescriptor(
    project: ParsedProject,
    meta: LeafLocatorMeta,
): TreeNodeDescriptor {
    const modules = project.sdd?.modules ?? [];
    return {
        label: `SDD (${modules.length} modules)`,
        collapsible: modules.length > 0,
        icon: 'book',
        contextValue: 'sddGroup',
        docId: 'SDD',
        children: modules.map((m) => ({
            label: m.path ?? m.title ?? '(unnamed module)',
            collapsible: false,
            locator: leafLocator(meta, m.path ?? ''),
            ui: m.ui,
            editArgs: m.path ? {
                type: 'SddModule',
                basePath: `/sdd/modules/module[path=${m.path}]`,
                formData: { path: m.path, title: m.title ?? '' },
                title: `Edit ${m.path}`,
            } : undefined,
        } as TreeNodeDescriptor)),
    };
}

function buildStpDescriptor(project: ParsedProject): TreeNodeDescriptor {
    const present = project.stp != null;
    return {
        label: present ? 'STP' : 'STP (empty)',
        collapsible: false,
        icon: 'checklist',
        contextValue: present ? 'revealable' : undefined,
        locator: present ? { tag: 'stp', value: '' } : undefined,
        docId: 'STP',
    };
}

// ---------------------------------------------------------------------
// Generic (schema-driven) payload nodes
// ---------------------------------------------------------------------

export function buildGenericPayloadDescriptors(
    project: ParsedProject,
): TreeNodeDescriptor[] {
    const nodes = project._nodes ?? {};
    const hints = project._ui_hints_index ?? {};
    const out: TreeNodeDescriptor[] = [];
    for (const key of Object.keys(nodes).sort()) {
        if (COVERED_TYPE_KEYS.has(key)) { continue; }
        const entry = hints[key];
        if (!entry || !entry.tree_node || !entry.element) { continue; }
        out.push(buildGenericGroupDescriptor(key, entry, nodes[key] ?? []));
    }
    return out;
}

function buildGenericGroupDescriptor(
    key: string,
    entry: UiHintEntry,
    parsedNodes: ParsedNode[],
): TreeNodeDescriptor {
    const tag = entry.element ?? key.toLowerCase();
    const idAttr = entry.tree_node?.id_attr ?? 'id';
    const labelTemplate = entry.tree_node?.label || `@${idAttr}`;
    const children: TreeNodeDescriptor[] = parsedNodes.map((n) => {
        const value = n.attrs[idAttr] ?? '';
        return {
            label: renderLabel(labelTemplate, n) || `(${tag})`,
            collapsible: false,
            locator: value ? { tag, attr: idAttr, value } : undefined,
            ui: n.ui ?? undefined,
            editArgs: (value && entry.form && entry.form.length > 0) ? {
                type: key,
                basePath: `/${tag}[${idAttr}=${value}]`,
                formData: { ...n.attrs },
                title: `Edit ${value}`,
            } : undefined,
        };
    });
    return {
        label: `${key} (${parsedNodes.length})`,
        collapsible: children.length > 0,
        icon: 'symbol-misc',
        children,
    };
}

// ---------------------------------------------------------------------
// Badge severity propagation
// ---------------------------------------------------------------------

export function propagateBadgeSeverity(nodes: TreeNodeDescriptor[]): void {
    for (const node of nodes) {
        if (!node.children?.length) {
            const sev = labelSeverity(node.label);
            if (sev === 'error') {
                node.icon = 'error';
                node.iconColor = 'list.errorForeground';
            } else if (sev === 'warning') {
                node.icon = 'warning';
                node.iconColor = 'list.warningForeground';
            }
            continue;
        }
        propagateBadgeSeverity(node.children);
        const worst = worstSeverity(
            node.children.map((c) => ({
                label: c.label,
                iconId: c.icon,
            })),
        );
        if (worst === 'error') {
            node.icon = 'error';
            node.iconColor = 'list.errorForeground';
        } else if (worst === 'warning') {
            node.icon = 'warning';
            node.iconColor = 'list.warningForeground';
        }
    }
}

// ---------------------------------------------------------------------
// AI-targetable decoration
// ---------------------------------------------------------------------

export function decorateAiTargetable(
    roots: TreeNodeDescriptor[],
    hints: ParsedProject['_ui_hints_index'],
): void {
    if (!hints) { return; }
    const tagsWithAi = new Set<string>();
    for (const entry of Object.values(hints)) {
        if (entry.element && entry.ai_actions && entry.ai_actions.length > 0) {
            tagsWithAi.add(entry.element);
        }
    }
    if (tagsWithAi.size === 0) { return; }
    const stack: TreeNodeDescriptor[] = [...roots];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.locator && tagsWithAi.has(node.locator.tag)) {
            node.aiTargetable = true;
        }
        if (node.children) { stack.push(...node.children); }
    }
}
