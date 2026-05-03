// Pure coverage-lens logic extracted from CoverageCodeLensProvider.ts
// (humble object pattern, Phase 10).
//
// Everything here is free of vscode imports and can be tested in a
// plain Node process via the tier-1 mocha suite.

import {
    ParsedHlr,
    ParsedLlr,
    ParsedProject,
    ParsedTest,
    UiHintsIndex,
} from '../sidecar';

// Re-export RevealLocator so lens-logic consumers don't need a
// separate import from ProjectSpecProvider.
export type { RevealLocator } from '../treeView/ProjectSpecProvider';
import type { RevealLocator } from '../treeView/ProjectSpecProvider';

// ---------------------------------------------------------------------
// Related-item types
// ---------------------------------------------------------------------

export interface RelatedItem {
    readonly label: string;
    readonly locator: RevealLocator;
    readonly description?: string;
}

// ---------------------------------------------------------------------
// Coverage index
// ---------------------------------------------------------------------

export interface CoverageIndex {
    readonly llrsByHlr: Map<string, ParsedLlr[]>;
    readonly testsByHlr: Map<string, ParsedTest[]>;
    readonly testsByLlr: Map<string, ParsedTest[]>;
    readonly hlrById: Map<string, ParsedHlr>;
    readonly llrById: Map<string, ParsedLlr>;
}

export function buildIndex(project: ParsedProject): CoverageIndex {
    const llrsByHlr = new Map<string, ParsedLlr[]>();
    const testsByHlr = new Map<string, ParsedTest[]>();
    const testsByLlr = new Map<string, ParsedTest[]>();
    const hlrById = new Map<string, ParsedHlr>();
    const llrById = new Map<string, ParsedLlr>();

    const flatHlrs = project.flat_hlrs ?? collectHlrs(project);
    const flatLlrs = project.flat_llrs ?? collectLlrs(project);
    const flatTests = project.flat_tests ?? collectTests(project);

    for (const h of flatHlrs) {
        if (h.id) { hlrById.set(h.id, h); }
    }
    for (const l of flatLlrs) {
        if (l.id) { llrById.set(l.id, l); }
    }
    for (const llr of flatLlrs) {
        for (const tr of llr.traces ?? []) {
            if (tr.target === 'HLR' && tr.ref) {
                pushTo(llrsByHlr, tr.ref, llr);
            }
        }
    }
    for (const t of flatTests) {
        for (const tr of t.traces ?? []) {
            if (!tr.ref) { continue; }
            if (tr.target === 'HLR') {
                pushTo(testsByHlr, tr.ref, t);
            } else if (tr.target === 'LLR') {
                pushTo(testsByLlr, tr.ref, t);
            }
        }
    }
    return { llrsByHlr, testsByHlr, testsByLlr, hlrById, llrById };
}

// ---------------------------------------------------------------------
// Related-item lookup
// ---------------------------------------------------------------------

export function relatedForHlr(id: string, index: CoverageIndex): RelatedItem[] {
    const items: RelatedItem[] = [];
    for (const llr of index.llrsByHlr.get(id) ?? []) {
        items.push({
            label: llr.id,
            description: 'LLR',
            locator: { tag: 'llr', value: llr.id },
        });
    }
    for (const test of index.testsByHlr.get(id) ?? []) {
        items.push({
            label: test.name,
            description: 'test',
            locator: { tag: 'test', attr: 'name', value: test.name },
        });
    }
    return items;
}

export function relatedForLlr(id: string, index: CoverageIndex): RelatedItem[] {
    const items: RelatedItem[] = [];
    const llr = index.llrById.get(id);
    if (llr) {
        for (const tr of llr.traces ?? []) {
            if (tr.target === 'HLR' && tr.ref) {
                items.push({
                    label: tr.ref,
                    description: 'HLR',
                    locator: { tag: 'hlr', value: tr.ref },
                });
            }
        }
    }
    for (const test of index.testsByLlr.get(id) ?? []) {
        items.push({
            label: test.name,
            description: 'test',
            locator: { tag: 'test', attr: 'name', value: test.name },
        });
    }
    return items;
}

export function relatedForTest(name: string, index: CoverageIndex): RelatedItem[] {
    const items: RelatedItem[] = [];
    const test = findTestByName(index, name);
    for (const tr of test?.traces ?? []) {
        if (!tr.ref) { continue; }
        if (tr.target === 'LLR') {
            items.push({
                label: tr.ref,
                description: 'LLR',
                locator: { tag: 'llr', value: tr.ref },
            });
        } else if (tr.target === 'HLR') {
            items.push({
                label: tr.ref,
                description: 'HLR',
                locator: { tag: 'hlr', value: tr.ref },
            });
        }
    }
    return items;
}

export function findTestByName(index: CoverageIndex, name: string): ParsedTest | undefined {
    for (const list of index.testsByLlr.values()) {
        const hit = list.find((t) => t.name === name);
        if (hit) { return hit; }
    }
    for (const list of index.testsByHlr.values()) {
        const hit = list.find((t) => t.name === name);
        if (hit) { return hit; }
    }
    return undefined;
}

// ---------------------------------------------------------------------
// Summary text
// ---------------------------------------------------------------------

export function summaryForHlr(related: RelatedItem[]): string {
    const llrs = related.filter((r) => r.description === 'LLR').length;
    const tests = related.filter((r) => r.description === 'test').length;
    return `${pluralize(llrs, 'LLR')} \u00b7 ${pluralize(tests, 'test')}`;
}

export function summaryForLlr(related: RelatedItem[]): string {
    const hlrs = related.filter((r) => r.description === 'HLR').length;
    const tests = related.filter((r) => r.description === 'test').length;
    return `${pluralize(hlrs, 'HLR')} \u00b7 ${pluralize(tests, 'test')}`;
}

export function summaryForTest(related: RelatedItem[]): string {
    const llrs = related.filter((r) => r.description === 'LLR').length;
    const hlrs = related.filter((r) => r.description === 'HLR').length;
    return `${pluralize(llrs, 'LLR')} \u00b7 ${pluralize(hlrs, 'HLR')}`;
}

export function defaultSummary(related: RelatedItem[]): string {
    return pluralize(related.length, 'related');
}

export function pluralize(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------
// Schema-driven lens targets
// ---------------------------------------------------------------------

export interface LensTarget {
    readonly element: string;
    readonly idAttr: string;
    readonly label: string;
    readonly summary: (related: RelatedItem[]) => string;
}

export const SUPPORTED_LENS_KINDS = new Set(['coverage', 'tracesCount']);

export const RELATED_DISPATCH: Record<string, (value: string, index: CoverageIndex) => RelatedItem[]> = {
    hlr:  relatedForHlr,
    llr:  relatedForLlr,
    test: relatedForTest,
};

const ELEMENT_LABELS: Record<string, string> = {
    hlr:  'HLR',
    llr:  'LLR',
    test: 'test',
};

const SUMMARY_DISPATCH: Record<string, (r: RelatedItem[]) => string> = {
    hlr:  summaryForHlr,
    llr:  summaryForLlr,
    test: summaryForTest,
};

const LEGACY_LENS_TARGETS: LensTarget[] = [
    { element: 'hlr',  idAttr: 'id',   label: 'HLR',  summary: summaryForHlr  },
    { element: 'llr',  idAttr: 'id',   label: 'LLR',  summary: summaryForLlr  },
    { element: 'test', idAttr: 'name', label: 'test', summary: summaryForTest },
];

export function getLensTargets(hints: UiHintsIndex | undefined): LensTarget[] {
    if (!hints) {
        return LEGACY_LENS_TARGETS;
    }
    const out: LensTarget[] = [];
    const seen = new Set<string>();
    for (const key of Object.keys(hints)) {
        const entry = hints[key];
        if (!entry?.element || !entry.tree_node) { continue; }
        const wanted = entry.lenses.some((l) => SUPPORTED_LENS_KINDS.has(l.kind));
        if (!wanted) { continue; }
        if (seen.has(entry.element)) { continue; }
        seen.add(entry.element);
        out.push({
            element: entry.element,
            idAttr: entry.tree_node.id_attr || 'id',
            label: ELEMENT_LABELS[entry.element] ?? entry.element.toUpperCase(),
            summary: SUMMARY_DISPATCH[entry.element] ?? defaultSummary,
        });
    }
    return out.length > 0 ? out : LEGACY_LENS_TARGETS;
}

// ---------------------------------------------------------------------
// Regex and matching helpers
// ---------------------------------------------------------------------

const ATTR_ESCAPE = /[.*+?^${}()|[\]\\]/g;

export function buildElementIdRegex(element: string, idAttr: string): RegExp {
    const tag  = element.replace(ATTR_ESCAPE, '\\$&');
    const attr = idAttr.replace(ATTR_ESCAPE, '\\$&');
    return new RegExp(`<${tag}\\b[^>]*?\\b${attr}="([^"]+)"`, 'g');
}

export function* matchAll(text: string, re: RegExp): Generator<RegExpExecArray> {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
        yield m;
        if (m.index === re.lastIndex) { re.lastIndex++; }
    }
}

// ---------------------------------------------------------------------
// Lens descriptor (pure data — no vscode.CodeLens)
// ---------------------------------------------------------------------

export const MAX_INLINE_LENSES = 6;
export const REVEAL_COMMAND = 'projectXml.revealInXml';
export const PICK_RELATED_COMMAND = 'projectXml.codeLens.pickRelated';

export interface LensDescriptor {
    title: string;
    command: string;
    tooltip?: string;
    arguments?: unknown[];
}

export function computeLensDescriptors(
    summary: string,
    pickerTitle: string,
    related: RelatedItem[],
): LensDescriptor[] {
    if (related.length === 0) {
        return [{
            title: `${summary} — no coverage`,
            command: '',
        }];
    }
    const out: LensDescriptor[] = [];
    out.push({
        title: summary,
        command: PICK_RELATED_COMMAND,
        tooltip: `Show all related items for ${pickerTitle}`,
        arguments: [{ title: pickerTitle, items: related }],
    });
    const inline = related.slice(0, MAX_INLINE_LENSES);
    for (const item of inline) {
        out.push({
            title: `\u2192 ${item.label}`,
            command: REVEAL_COMMAND,
            tooltip: `Reveal ${item.description ?? ''} ${item.label} in Project.xml`.trim(),
            arguments: [item.locator],
        });
    }
    if (related.length > MAX_INLINE_LENSES) {
        const overflow = related.length - MAX_INLINE_LENSES;
        out.push({
            title: `+${overflow} more\u2026`,
            command: PICK_RELATED_COMMAND,
            arguments: [{ title: pickerTitle, items: related }],
        });
    }
    return out;
}

// ---------------------------------------------------------------------
// Collection helpers
// ---------------------------------------------------------------------

export function collectHlrs(project: ParsedProject): ParsedHlr[] {
    const out: ParsedHlr[] = [];
    for (const sec of project.hlrs ?? []) {
        for (const h of sec.hlrs ?? []) { out.push(h); }
    }
    return out;
}

export function collectLlrs(project: ParsedProject): ParsedLlr[] {
    const out: ParsedLlr[] = [];
    for (const g of project.llrs ?? []) {
        for (const l of g.llrs ?? []) { out.push(l); }
    }
    return out;
}

export function collectTests(project: ParsedProject): ParsedTest[] {
    const out: ParsedTest[] = [];
    for (const f of project.tests ?? []) {
        for (const t of f.tests ?? []) { out.push(t); }
    }
    return out;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const existing = map.get(key);
    if (existing) { existing.push(value); }
    else { map.set(key, [value]); }
}
