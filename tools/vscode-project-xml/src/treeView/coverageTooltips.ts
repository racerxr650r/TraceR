// Tree-view tooltip enrichment: build a Markdown summary of each
// HLR/LLR/test leaf's downstream and upstream coverage so the same
// information shown by the inline code lenses is visible on hover
// in the Project Spec tree view.
//
// Mirrors the index construction in
// codeLens/CoverageCodeLensProvider.ts but is kept local to the
// tree-view module to avoid a cross-folder import cycle. The two
// implementations share the same parsed-project shape so they stay
// in lock-step semantically; tier-1 unit tests pin the tooltip
// strings.

import * as vscode from 'vscode';
import {
    ParsedHlr,
    ParsedLlr,
    ParsedProject,
    ParsedTest,
} from '../sidecar';
import { ProjectSpecNode, RevealLocator } from './ProjectSpecProvider';

interface CoverageIndex {
    /** HLR-NNN → LLRs that trace to it. */
    readonly llrsByHlr: Map<string, ParsedLlr[]>;
    /** HLR-NNN → tests that trace to it. */
    readonly testsByHlr: Map<string, ParsedTest[]>;
    /** LLR-XXX-NN → tests that trace to it. */
    readonly testsByLlr: Map<string, ParsedTest[]>;
    /** HLR-NNN → ParsedHlr (for label resolution). */
    readonly hlrById: Map<string, ParsedHlr>;
    /** LLR-XXX-NN → ParsedLlr. */
    readonly llrById: Map<string, ParsedLlr>;
    /** test name → ParsedTest. */
    readonly testByName: Map<string, ParsedTest>;
}

/**
 * Build the coverage index used to populate tooltips. Walks the
 * `flat_*` payloads when the renderer exposes them, falling back to
 * the nested shape otherwise.
 *
 * Exported for tier-1 tests.
 */
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
        if (h.id) {
            hlrById.set(h.id, h);
        }
    }
    for (const l of flatLlrs) {
        if (l.id) {
            llrById.set(l.id, l);
        }
    }
    for (const t of flatTests) {
        if (t.name) {
            testByName.set(t.name, t);
        }
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
            if (!tr.ref) {
                continue;
            }
            if (tr.target === 'HLR') {
                pushTo(testsByHlr, tr.ref, t);
            } else if (tr.target === 'LLR') {
                pushTo(testsByLlr, tr.ref, t);
            }
        }
    }
    return { llrsByHlr, testsByHlr, testsByLlr, hlrById, llrById, testByName };
}

/**
 * Walk the built tree and attach a Markdown tooltip to every leaf
 * whose locator maps to an HLR, LLR, or test. The tooltip lists
 * upstream and downstream items as clickable command links to
 * `projectXml.revealInXml` so a hover preview can navigate without
 * leaving the tree.
 */
export function decorateTooltips(
    roots: ProjectSpecNode[],
    project: ParsedProject,
): void {
    const index = buildCoverageIndex(project);
    const stack: ProjectSpecNode[] = [...roots];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.locator) {
            const tooltip = buildTooltip(node.locator, index);
            if (tooltip) {
                node.tooltip = tooltip;
            }
        }
        if (node.children) {
            stack.push(...node.children);
        }
    }
}

/**
 * Compose a Markdown tooltip for a single tree leaf. Returns
 * `undefined` when the locator does not correspond to a coverage-
 * bearing element so the tree provider leaves the existing tooltip
 * (or VS Code's default label tooltip) in place.
 *
 * Exported for tier-1 tests.
 */
export function buildTooltip(
    locator: RevealLocator,
    index: CoverageIndex,
): vscode.MarkdownString | undefined {
    switch (locator.tag) {
        case 'hlr':
            return tooltipForHlr(locator.value, index);
        case 'llr':
            return tooltipForLlr(locator.value, index);
        case 'test':
            return tooltipForTest(locator.value, index);
        default:
            return undefined;
    }
}

function tooltipForHlr(
    id: string,
    index: CoverageIndex,
): vscode.MarkdownString {
    const md = makeMd();
    const hlr = index.hlrById.get(id);
    md.appendMarkdown(`**HLR \`${id}\`**`);
    if (hlr?.name) {
        md.appendMarkdown(` — ${escapeMd(hlr.name)}`);
    }
    md.appendMarkdown('\n\n');

    const llrs = index.llrsByHlr.get(id) ?? [];
    const tests = index.testsByHlr.get(id) ?? [];
    md.appendMarkdown(
        `_Coverage: ${pluralize(llrs.length, 'LLR')} · ${pluralize(tests.length, 'test')}_\n\n`,
    );
    appendList(md, 'Downstream LLRs', llrs.map((l) => ({
        label: l.id,
        locator: { tag: 'llr', value: l.id },
    })));
    appendList(md, 'Direct tests', tests.map((t) => ({
        label: t.name,
        locator: { tag: 'test', attr: 'name', value: t.name },
    })));
    if (llrs.length === 0 && tests.length === 0) {
        md.appendMarkdown('_No downstream LLRs or tests yet._\n');
    }
    return md;
}

function tooltipForLlr(
    id: string,
    index: CoverageIndex,
): vscode.MarkdownString {
    const md = makeMd();
    const llr = index.llrById.get(id);
    md.appendMarkdown(`**LLR \`${id}\`**\n\n`);

    const upstream: { ref: string; target: 'HLR' | 'LLR' }[] = [];
    for (const tr of llr?.traces ?? []) {
        if (tr.target === 'HLR' && tr.ref) {
            upstream.push({ ref: tr.ref, target: 'HLR' });
        }
    }
    const tests = index.testsByLlr.get(id) ?? [];
    md.appendMarkdown(
        `_Coverage: ${pluralize(upstream.length, 'HLR trace')} · ${pluralize(tests.length, 'test')}_\n\n`,
    );
    appendList(md, 'Upstream HLRs', upstream.map((u) => ({
        label: u.ref,
        sublabel: index.hlrById.get(u.ref)?.name,
        locator: { tag: 'hlr', value: u.ref },
    })));
    appendList(md, 'Tests', tests.map((t) => ({
        label: t.name,
        locator: { tag: 'test', attr: 'name', value: t.name },
    })));
    if (upstream.length === 0 && tests.length === 0) {
        md.appendMarkdown('_No traces or tests yet._\n');
    }
    return md;
}

function tooltipForTest(
    name: string,
    index: CoverageIndex,
): vscode.MarkdownString {
    const md = makeMd();
    const test = index.testByName.get(name);
    md.appendMarkdown(`**Test \`${escapeMd(name)}\`**\n\n`);
    const hlrTraces: string[] = [];
    const llrTraces: string[] = [];
    for (const tr of test?.traces ?? []) {
        if (!tr.ref) {
            continue;
        }
        if (tr.target === 'HLR') {
            hlrTraces.push(tr.ref);
        } else if (tr.target === 'LLR') {
            llrTraces.push(tr.ref);
        }
    }
    md.appendMarkdown(
        `_Traces: ${pluralize(hlrTraces.length, 'HLR')} · ${pluralize(llrTraces.length, 'LLR')}_\n\n`,
    );
    appendList(md, 'Upstream HLRs', hlrTraces.map((id) => ({
        label: id,
        sublabel: index.hlrById.get(id)?.name,
        locator: { tag: 'hlr', value: id },
    })));
    appendList(md, 'Upstream LLRs', llrTraces.map((id) => ({
        label: id,
        locator: { tag: 'llr', value: id },
    })));
    if (hlrTraces.length === 0 && llrTraces.length === 0) {
        md.appendMarkdown('_No traces yet._\n');
    }
    return md;
}

interface ListEntry {
    readonly label: string;
    readonly sublabel?: string;
    readonly locator: RevealLocator;
}

function appendList(
    md: vscode.MarkdownString,
    heading: string,
    entries: ListEntry[],
): void {
    if (entries.length === 0) {
        return;
    }
    md.appendMarkdown(`**${heading}**\n\n`);
    for (const entry of entries) {
        const link = revealCommandLink(entry.label, entry.locator);
        const sub = entry.sublabel ? ` — ${escapeMd(entry.sublabel)}` : '';
        md.appendMarkdown(`* ${link}${sub}\n`);
    }
    md.appendMarkdown('\n');
}

function revealCommandLink(label: string, locator: RevealLocator): string {
    const args = encodeURIComponent(JSON.stringify([locator]));
    return `[\`${label}\`](command:projectXml.revealInXml?${args})`;
}

function makeMd(): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    // `isTrusted` is required for `command:` links to be clickable.
    md.isTrusted = true;
    md.supportHtml = false;
    return md;
}

function pluralize(n: number, singular: string): string {
    return n === 1 ? `${n} ${singular}` : `${n} ${singular}s`;
}

function escapeMd(text: string): string {
    return text.replace(/[\\`*_{}\[\]()#+\-.!|<>]/g, (m) => `\\${m}`);
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const existing = map.get(key);
    if (existing) {
        existing.push(value);
    } else {
        map.set(key, [value]);
    }
}

function collectHlrs(project: ParsedProject): ParsedHlr[] {
    const out: ParsedHlr[] = [];
    for (const sec of project.hlrs ?? []) {
        for (const h of sec.hlrs ?? []) {
            out.push(h);
        }
    }
    return out;
}

function collectLlrs(project: ParsedProject): ParsedLlr[] {
    const out: ParsedLlr[] = [];
    for (const g of project.llrs ?? []) {
        for (const l of g.llrs ?? []) {
            out.push(l);
        }
    }
    return out;
}

function collectTests(project: ParsedProject): ParsedTest[] {
    const out: ParsedTest[] = [];
    for (const f of project.tests ?? []) {
        for (const t of f.tests ?? []) {
            out.push(t);
        }
    }
    return out;
}
