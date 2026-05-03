// Pure form logic extracted from FormPanelProvider.ts
// (humble object pattern, Phase 10).
//
// All form-data-to-ops transformation, schema derivation helpers,
// coverage computation, and HTML utilities live here so they can be
// tested without a vscode dependency.

import {
    EditOperation,
    ParsedProject,
    ParsedSection,
    ParsedLlrGroup,
    ParsedTestFile,
    UiFormField,
} from '../sidecar';
import {
    buildCoverageIndex,
    CoverageIndex,
} from '../treeView/coverageTooltipLogic';
import type { RevealLocator } from '../treeView/treeLogic';

// Re-export CoverageIndex for backward compat (FormPanelProvider
// used to import it from coverageTooltips).
export type { CoverageIndex } from '../treeView/coverageTooltipLogic';
export { buildCoverageIndex } from '../treeView/coverageTooltipLogic';

// ---------------------------------------------------------------------
// Form parameter types
// ---------------------------------------------------------------------

export type FormPayloadKind = string;

export interface OpenFormParams {
    type: FormPayloadKind;
    initial: Record<string, unknown>;
    basePath?: string;
    appendPath?: string;
    title: string;
}

// ---------------------------------------------------------------------
// Coverage link types (for the read-only traceability panel)
// ---------------------------------------------------------------------

export interface CoverageLink {
    label: string;
    sublabel?: string;
    tag: string;
    attr?: string;
    value: string;
}

export interface CoverageLinkSection {
    heading: string;
    items: CoverageLink[];
}

export interface CoverageInfo {
    summary: string;
    sections: CoverageLinkSection[];
}

// ---------------------------------------------------------------------
// buildOperations — form submission → JSON Patch
// ---------------------------------------------------------------------

export function buildOperations(
    params: OpenFormParams,
    formData: Record<string, unknown>,
    fields?: ReadonlyArray<UiFormField>,
): EditOperation[] {
    const lookup = makeAttributeLookup(fields);
    if (params.basePath) {
        return buildReplaceOperations(params.basePath, formData, lookup);
    }
    if (!params.appendPath) {
        throw new Error('OpenFormParams must supply either basePath or appendPath');
    }
    return [{
        op: 'add',
        path: params.appendPath,
        value: toElementSpec(formData, lookup),
    }];
}

function buildReplaceOperations(
    basePath: string,
    formData: Record<string, unknown>,
    isAttribute: (key: string) => boolean,
): EditOperation[] {
    const ops: EditOperation[] = [];
    let idOp: EditOperation | undefined;
    for (const [key, value] of Object.entries(formData)) {
        if (value === undefined) { continue; }
        if (key === 'traces') {
            ops.push({
                op: 'replace',
                path: `${basePath}/traces`,
                value: { trace: tracesToList(value) },
            });
            continue;
        }
        if (isAttribute(key)) {
            const op: EditOperation = {
                op: 'replace',
                path: `${basePath}/@${key}`,
                value: String(value ?? ''),
            };
            if (key === 'id') { idOp = op; }
            else { ops.push(op); }
            continue;
        }
        ops.push({
            op: 'replace',
            path: `${basePath}/${key}`,
            value: value ?? '',
        });
    }
    if (idOp) { ops.push(idOp); }
    return ops;
}

function toElementSpec(
    formData: Record<string, unknown>,
    isAttribute: (key: string) => boolean,
): Record<string, unknown> {
    const spec: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(formData)) {
        if (value === undefined) { continue; }
        if (isAttribute(key)) {
            spec[`@${key}`] = String(value ?? '');
            continue;
        }
        if (key === 'traces') {
            const list = tracesToList(value);
            if (list.length) { spec.traces = { trace: list }; }
            continue;
        }
        spec[key] = value;
    }
    return spec;
}

function tracesToList(value: unknown): Array<Record<string, string>> {
    if (!Array.isArray(value)) { return []; }
    const out: Array<Record<string, string>> = [];
    for (const row of value) {
        if (!row || typeof row !== 'object') { continue; }
        const r = row as Record<string, unknown>;
        if (!r.target || !r.ref) { continue; }
        const trace: Record<string, string> = {
            '@target': String(r.target),
            '@ref': String(r.ref),
        };
        if (r.name !== undefined && r.name !== null && String(r.name).trim() !== '') {
            trace['@name'] = String(r.name);
        }
        out.push(trace);
    }
    return out;
}

function makeAttributeLookup(
    fields: ReadonlyArray<UiFormField> | undefined,
): (key: string) => boolean {
    if (!fields || fields.length === 0) {
        return (key) => key === 'id' || key === 'name';
    }
    const attrs = new Set<string>();
    for (const f of fields) {
        if (f.kind === 'attr') { attrs.add(f.target); }
    }
    return (key) => attrs.has(key);
}

// ---------------------------------------------------------------------
// computeCoverage — read-only traceability for form panel
// ---------------------------------------------------------------------

export function computeCoverage(
    parsed: ParsedProject,
    type: string,
    initial: Record<string, unknown>,
): CoverageInfo | undefined {
    const index = buildCoverageIndex(parsed);
    switch (type) {
        case 'Hlr':
            return hlrCoverage(String(initial.id ?? ''), index);
        case 'Llr':
            return llrCoverage(String(initial.id ?? ''), index);
        case 'Test':
            return testCoverage(String(initial.name ?? ''), index);
        case 'SddModule':
            return sddCoverage(String(initial.path ?? ''), parsed);
        default:
            return undefined;
    }
}

function hlrCoverage(id: string, index: CoverageIndex): CoverageInfo | undefined {
    if (!id) { return undefined; }
    const llrs = index.llrsByHlr.get(id) ?? [];
    const tests = index.testsByHlr.get(id) ?? [];
    const sections: CoverageLinkSection[] = [];
    if (llrs.length) {
        sections.push({
            heading: 'Downstream LLRs',
            items: llrs.map((l) => ({ label: l.id, tag: 'llr', value: l.id })),
        });
    }
    if (tests.length) {
        sections.push({
            heading: 'Direct tests',
            items: tests.map((t) => ({ label: t.name, sublabel: t.file, tag: 'test', attr: 'name', value: t.name })),
        });
    }
    return {
        summary: `${plural(llrs.length, 'LLR')} \u00b7 ${plural(tests.length, 'test')}`,
        sections,
    };
}

function llrCoverage(id: string, index: CoverageIndex): CoverageInfo | undefined {
    if (!id) { return undefined; }
    const llr = index.llrById.get(id);
    const upstream: CoverageLink[] = [];
    for (const tr of llr?.traces ?? []) {
        if (tr.target === 'HLR' && tr.ref) {
            const hlr = index.hlrById.get(tr.ref);
            upstream.push({
                label: tr.ref,
                sublabel: hlr?.name,
                tag: 'hlr',
                value: tr.ref,
            });
        }
    }
    const tests = index.testsByLlr.get(id) ?? [];
    const sections: CoverageLinkSection[] = [];
    if (upstream.length) {
        sections.push({ heading: 'Upstream HLRs', items: upstream });
    }
    if (tests.length) {
        sections.push({
            heading: 'Tests',
            items: tests.map((t) => ({ label: t.name, sublabel: t.file, tag: 'test', attr: 'name', value: t.name })),
        });
    }
    return {
        summary: `${plural(upstream.length, 'HLR trace')} \u00b7 ${plural(tests.length, 'test')}`,
        sections,
    };
}

function testCoverage(name: string, index: CoverageIndex): CoverageInfo | undefined {
    if (!name) { return undefined; }
    const test = index.testByName.get(name);
    const hlrLinks: CoverageLink[] = [];
    const llrLinks: CoverageLink[] = [];
    for (const tr of test?.traces ?? []) {
        if (!tr.ref) { continue; }
        if (tr.target === 'HLR') {
            const hlr = index.hlrById.get(tr.ref);
            hlrLinks.push({ label: tr.ref, sublabel: hlr?.name, tag: 'hlr', value: tr.ref });
        } else if (tr.target === 'LLR') {
            llrLinks.push({ label: tr.ref, tag: 'llr', value: tr.ref });
        }
    }
    const sections: CoverageLinkSection[] = [];
    if (hlrLinks.length) { sections.push({ heading: 'Upstream HLRs', items: hlrLinks }); }
    if (llrLinks.length) { sections.push({ heading: 'Upstream LLRs', items: llrLinks }); }
    if (test?.file) {
        sections.push({
            heading: 'Source file',
            items: [{ label: test.file, tag: 'file', value: test.file }],
        });
    }
    return {
        summary: `${plural(hlrLinks.length, 'HLR')} \u00b7 ${plural(llrLinks.length, 'LLR')}`,
        sections,
    };
}

function sddCoverage(path: string, parsed: ParsedProject): CoverageInfo | undefined {
    if (!path) { return undefined; }
    const flatHlrs = parsed.flat_hlrs ?? collectHlrsFlat(parsed);
    const hlrLinks: CoverageLink[] = [];
    for (const hlr of flatHlrs) {
        for (const tr of hlr.traces ?? []) {
            if (tr.target === 'SDD' && tr.ref === path) {
                hlrLinks.push({ label: hlr.id, sublabel: hlr.name, tag: 'hlr', value: hlr.id });
                break;
            }
        }
    }
    const sections: CoverageLinkSection[] = [];
    if (hlrLinks.length) {
        sections.push({ heading: 'HLRs tracing to this module', items: hlrLinks });
    }
    return { summary: `${plural(hlrLinks.length, 'HLR')}`, sections };
}

function collectHlrsFlat(project: ParsedProject): Array<{ id: string; name?: string; traces?: Array<{ target?: string; ref?: string }> }> {
    const out: Array<{ id: string; name?: string; traces?: Array<{ target?: string; ref?: string }> }> = [];
    for (const sec of project.hlrs ?? []) {
        for (const h of (sec as { hlrs?: Array<{ id: string; name?: string; traces?: Array<{ target?: string; ref?: string }> }> }).hlrs ?? []) {
            out.push(h);
        }
    }
    return out;
}

function plural(n: number, singular: string): string {
    return n === 1 ? `${n} ${singular}` : `${n} ${singular}s`;
}

// ---------------------------------------------------------------------
// resolveFormParams — coverage-link locator → form open params
// ---------------------------------------------------------------------

export function resolveFormParams(
    parsed: ParsedProject,
    locator: RevealLocator,
): OpenFormParams | undefined {
    const { tag, value } = locator;
    switch (tag) {
        case 'hlr': {
            for (const sec of (parsed.hlrs ?? []) as ParsedSection[]) {
                for (const h of (sec as { hlrs?: Array<Record<string, unknown>> }).hlrs ?? []) {
                    if (h.id === value) {
                        return {
                            type: 'Hlr',
                            title: `Edit ${value}`,
                            initial: { ...h } as Record<string, unknown>,
                            basePath: `/hlrs/section[number=${sec.number}]/hlr[id=${value}]`,
                        };
                    }
                }
            }
            return undefined;
        }
        case 'llr': {
            for (const fn of (parsed.llrs ?? []) as ParsedLlrGroup[]) {
                for (const l of fn.llrs ?? []) {
                    if (l.id === value) {
                        return {
                            type: 'Llr',
                            title: `Edit ${value}`,
                            initial: { ...l } as Record<string, unknown>,
                            basePath: `/llrs/function[number=${fn.number}]/llr[id=${value}]`,
                        };
                    }
                }
            }
            return undefined;
        }
        case 'test': {
            for (const f of (parsed.tests ?? []) as ParsedTestFile[]) {
                for (const t of f.tests ?? []) {
                    if (t.name === value) {
                        return {
                            type: 'Test',
                            title: `Edit ${value}`,
                            initial: { ...t, file: f.path } as Record<string, unknown>,
                            basePath: `/tests/file[path=${f.path}]/test[name=${value}]`,
                        };
                    }
                }
            }
            return undefined;
        }
        case 'module': {
            for (const m of parsed.sdd?.modules ?? []) {
                if (m.path === value) {
                    return {
                        type: 'SddModule',
                        title: `Edit ${value}`,
                        initial: { ...m } as Record<string, unknown>,
                        basePath: `/sdd/modules/module[path=${value}]`,
                    };
                }
            }
            return undefined;
        }
        default:
            return undefined;
    }
}

// ---------------------------------------------------------------------
// locatorFromBasePath — derive a RevealLocator from a form base path
// ---------------------------------------------------------------------

export function locatorFromBasePath(basePath: string | undefined): RevealLocator | undefined {
    if (!basePath) { return undefined; }
    const m = basePath.match(/\/(\w+)\[(\w+)=([^\]]+)\]\s*$/);
    if (!m) { return undefined; }
    const [, tag, attr, value] = m;
    return attr === 'id' ? { tag, value } : { tag, attr, value };
}

// ---------------------------------------------------------------------
// HTML utilities
// ---------------------------------------------------------------------

export function escapeHtml(s: string): string {
    return s.replace(/[&<>"\x27]/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "\'": '&#39;',
    }[c] as string));
}
