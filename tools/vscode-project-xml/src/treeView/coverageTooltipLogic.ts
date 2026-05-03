// Pure tooltip-markdown generation extracted from coverageTooltips.ts
// (humble object pattern, Phase 10).
//
// Returns raw Markdown strings; the wrapper in coverageTooltips.ts
// wraps them in vscode.MarkdownString with isTrusted = true.

import {
    ParsedHlr,
    ParsedLlr,
    ParsedProject,
    ParsedTest,
} from '../sidecar';
import type { RevealLocator } from './treeLogic';

// ---------------------------------------------------------------------
// Coverage index (same shape as coverageTooltips.ts used internally)
// ---------------------------------------------------------------------

export interface CoverageIndex {
    readonly llrsByHlr: Map<string, ParsedLlr[]>;
    readonly testsByHlr: Map<string, ParsedTest[]>;
    readonly testsByLlr: Map<string, ParsedTest[]>;
    readonly hlrById: Map<string, ParsedHlr>;
    readonly llrById: Map<string, ParsedLlr>;
    readonly testByName: Map<string, ParsedTest>;
}

export function buildCoverageIndex(project: ParsedProject): CoverageIndex {
    const llrsByHlr = new Map<string, ParsedLlr[]>();
    const testsByHlr = new Map<string, ParsedTest[]>();
    const testsByLlr = new Map<string, ParsedTest[]>();
    const hlrById = new Map<string, ParsedHlr>();
    const llrById = new Map<string, ParsedLlr>();
    const testByName = new Map<string, ParsedTest>();

    const flatHlrs = project.flat_hlrs ?? collectHlrs(project);
    const flatLlrs = project.flat_llrs ?? collectLlrs(project);
    const flatTests = project.flat_tests ?? collectTests(project);

    for (const h of flatHlrs) {
        if (h.id) { hlrById.set(h.id, h); }
    }
    for (const l of flatLlrs) {
        if (l.id) { llrById.set(l.id, l); }
    }
    for (const t of flatTests) {
        if (t.name) { testByName.set(t.name, t); }
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
    return { llrsByHlr, testsByHlr, testsByLlr, hlrById, llrById, testByName };
}

// ---------------------------------------------------------------------
// Tooltip markdown generation
// ---------------------------------------------------------------------

export function tooltipMarkdownForHlr(
    id: string,
    index: CoverageIndex,
): string | undefined {
    const hlr = index.hlrById.get(id);
    const lines: string[] = [];
    lines.push(`**HLR \`${id}\`**${hlr?.name ? ` \u2014 ${hlr.name}` : ''}`);
    lines.push('');

    const llrs = index.llrsByHlr.get(id) ?? [];
    const tests = index.testsByHlr.get(id) ?? [];
    lines.push(`_Coverage: ${pluralize(llrs.length, 'LLR')} \u00b7 ${pluralize(tests.length, 'test')}_`);
    lines.push('');
    appendList(lines, 'Downstream LLRs', llrs.map((l) => ({
        label: l.id,
        locator: { tag: 'llr', value: l.id } as RevealLocator,
    })));
    appendList(lines, 'Direct tests', tests.map((t) => ({
        label: t.name,
        sublabel: t.file,
        locator: { tag: 'test', attr: 'name', value: t.name } as RevealLocator,
    })));
    if (llrs.length === 0 && tests.length === 0) {
        lines.push('_No downstream LLRs or tests yet._');
    }
    return lines.join('\n');
}

export function tooltipMarkdownForLlr(
    id: string,
    index: CoverageIndex,
): string | undefined {
    const llr = index.llrById.get(id);
    const lines: string[] = [];
    lines.push(`**LLR \`${id}\`**`);
    lines.push('');

    const upstream: { ref: string }[] = [];
    for (const tr of llr?.traces ?? []) {
        if (tr.target === 'HLR' && tr.ref) {
            upstream.push({ ref: tr.ref });
        }
    }
    const tests = index.testsByLlr.get(id) ?? [];
    lines.push(`_Coverage: ${pluralize(upstream.length, 'HLR trace')} \u00b7 ${pluralize(tests.length, 'test')}_`);
    lines.push('');
    appendList(lines, 'Upstream HLRs', upstream.map((u) => ({
        label: u.ref,
        sublabel: index.hlrById.get(u.ref)?.name,
        locator: { tag: 'hlr', value: u.ref } as RevealLocator,
    })));
    appendList(lines, 'Tests', tests.map((t) => ({
        label: t.name,
        sublabel: t.file,
        locator: { tag: 'test', attr: 'name', value: t.name } as RevealLocator,
    })));
    if (upstream.length === 0 && tests.length === 0) {
        lines.push('_No traces or tests yet._');
    }
    return lines.join('\n');
}

export function tooltipMarkdownForTest(
    name: string,
    index: CoverageIndex,
): string | undefined {
    const test = index.testByName.get(name);
    const lines: string[] = [];
    lines.push(`**Test \`${name}\`**${test?.file ? ` \u2014 \`${test.file}\`` : ''}`);
    lines.push('');

    const hlrTraces: string[] = [];
    const llrTraces: string[] = [];
    for (const tr of test?.traces ?? []) {
        if (!tr.ref) { continue; }
        if (tr.target === 'HLR') { hlrTraces.push(tr.ref); }
        else if (tr.target === 'LLR') { llrTraces.push(tr.ref); }
    }
    lines.push(`_Traces: ${pluralize(hlrTraces.length, 'HLR')} \u00b7 ${pluralize(llrTraces.length, 'LLR')}_`);
    lines.push('');
    appendList(lines, 'Upstream HLRs', hlrTraces.map((id) => ({
        label: id,
        sublabel: index.hlrById.get(id)?.name,
        locator: { tag: 'hlr', value: id } as RevealLocator,
    })));
    appendList(lines, 'Upstream LLRs', llrTraces.map((id) => ({
        label: id,
        locator: { tag: 'llr', value: id } as RevealLocator,
    })));
    if (hlrTraces.length === 0 && llrTraces.length === 0) {
        lines.push('_No traces yet._');
    }
    return lines.join('\n');
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

export function revealCommandLink(label: string, locator: RevealLocator): string {
    const args = encodeURIComponent(JSON.stringify([locator]));
    return `[\`${label}\`](command:projectXml.revealInXml?${args})`;
}

export function pluralize(n: number, singular: string): string {
    return n === 1 ? `${n} ${singular}` : `${n} ${singular}s`;
}

interface ListEntry {
    readonly label: string;
    readonly sublabel?: string;
    readonly locator: RevealLocator;
}

function appendList(
    lines: string[],
    heading: string,
    entries: ListEntry[],
): void {
    if (entries.length === 0) { return; }
    lines.push(`**${heading}**`);
    lines.push('');
    for (const entry of entries) {
        const link = revealCommandLink(entry.label, entry.locator);
        const sub = entry.sublabel ? ` \u2014 ${entry.sublabel}` : '';
        lines.push(`* ${link}${sub}`);
    }
    lines.push('');
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const existing = map.get(key);
    if (existing) { existing.push(value); }
    else { map.set(key, [value]); }
}

function collectHlrs(project: ParsedProject): ParsedHlr[] {
    const out: ParsedHlr[] = [];
    for (const sec of project.hlrs ?? []) {
        for (const h of sec.hlrs ?? []) { out.push(h); }
    }
    return out;
}

function collectLlrs(project: ParsedProject): ParsedLlr[] {
    const out: ParsedLlr[] = [];
    for (const g of project.llrs ?? []) {
        for (const l of g.llrs ?? []) { out.push(l); }
    }
    return out;
}

function collectTests(project: ParsedProject): ParsedTest[] {
    const out: ParsedTest[] = [];
    for (const f of project.tests ?? []) {
        for (const t of f.tests ?? []) {
            out.push({ ...t, file: t.file ?? f.path });
        }
    }
    return out;
}
