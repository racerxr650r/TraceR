// CodeLensProvider for `<hlr>`, `<llr>`, and `<test>` elements in
// Project.xml.
//
// Each element gets a single summary lens (e.g. "3 LLRs · 5 tests")
// whose click action opens a QuickPick listing every related item,
// and one inline lens per related item (`→ LLR-PCL-01`) that jumps
// directly to that element. Both routes ultimately invoke
// `projectXml.revealInXml` with a locator, so the existing reveal
// path is the single jump implementation.
//
// Coverage is computed from the parsed project tree returned by the
// sidecar's `parse_to_json` method:
//
//   * For an HLR: count LLRs whose <traces> reference it (target=HLR,
//     ref=HLR-NNN) and tests whose <traces> reference it directly.
//   * For an LLR: count its own upstream HLR traces and tests whose
//     <traces> reference it.
//   * For a test: count the LLR and HLR traces it carries.
//
// Phase 2.5b Slice F: the (element, id_attr) pairs scanned for lenses
// are no longer hard-coded -- they come from `_ui_hints_index` filtered
// to entries whose `lenses` contains a `coverage` or `tracesCount`
// kind. Adding a new payload with one of those lens kinds wires the
// regex/range pass automatically; the `RELATED_DISPATCH` registry
// below is the only place that still encodes per-payload semantics.

import * as vscode from 'vscode';
import {
    ParsedHlr,
    ParsedLlr,
    ParsedProject,
    ParsedTest,
    ProjectIoClient,
    UiHintsIndex,
} from '../sidecar';
import { getProjectXmlPath } from '../util/paths';
import { RevealLocator } from '../treeView/ProjectSpecProvider';

/** Cap on per-related inline lenses; overflow is folded into the picker. */
const MAX_INLINE_LENSES = 6;

/** Command id used by the per-related lens; calls revealInXml. */
const REVEAL_COMMAND = 'projectXml.revealInXml';

/**
 * Command id of the picker used by the summary lens. Registered in
 * extension.ts and exported here so the contributing module wires the
 * same string in both places.
 */
export const PICK_RELATED_COMMAND = 'projectXml.codeLens.pickRelated';

interface RelatedItem {
    readonly label: string;
    readonly locator: RevealLocator;
    readonly description?: string;
}

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
}

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

    /** Drop the parsed-project cache and ask VS Code for a re-render. */
    refresh(): void {
        this.cachedProject = undefined;
        this.cachedIndex = undefined;
        this._onDidChange.fire();
    }

    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): Promise<vscode.CodeLens[]> {
        if (!isProjectXml(document)) {
            return [];
        }
        let project: ParsedProject;
        try {
            project = await this.ensureProject();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.outputChannel.appendLine(
                `[codelens] parse_to_json failed: ${message}`,
            );
            return [];
        }
        if (token.isCancellationRequested) {
            return [];
        }
        const index = this.cachedIndex ??= buildIndex(project);
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();

        for (const target of getLensTargets(project._ui_hints_index)) {
            const handler = RELATED_DISPATCH[target.element];
            if (!handler) {
                continue;
            }
            const regex = buildElementIdRegex(target.element, target.idAttr);
            for (const match of matchAll(text, regex)) {
                const range = rangeAt(document, match.index);
                const value = match[1];
                const related = handler(value, index);
                pushLenses(
                    lenses,
                    range,
                    target.summary(related),
                    `${target.label} ${value}`,
                    related,
                );
            }
        }
        return lenses;
    }

    private async ensureProject(): Promise<ParsedProject> {
        if (this.cachedProject) {
            return this.cachedProject;
        }
        if (this.inflight) {
            return this.inflight;
        }
        const xmlPath = getProjectXmlPath();
        const params = xmlPath ? { xml_path: xmlPath } : {};
        this.inflight = this.client.parseToJson(params)
            .then((p) => {
                this.cachedProject = p;
                this.cachedIndex = undefined;
                return p;
            })
            .finally(() => {
                this.inflight = undefined;
            });
        return this.inflight;
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}

// ---------------------------------------------------------------------
// Index construction
// ---------------------------------------------------------------------

function buildIndex(project: ParsedProject): CoverageIndex {
    const llrsByHlr = new Map<string, ParsedLlr[]>();
    const testsByHlr = new Map<string, ParsedTest[]>();
    const testsByLlr = new Map<string, ParsedTest[]>();
    const hlrById = new Map<string, ParsedHlr>();
    const llrById = new Map<string, ParsedLlr>();

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
    return { llrsByHlr, testsByHlr, testsByLlr, hlrById, llrById };
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

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const existing = map.get(key);
    if (existing) {
        existing.push(value);
    } else {
        map.set(key, [value]);
    }
}

// ---------------------------------------------------------------------
// Per-element related-item lookup
// ---------------------------------------------------------------------

function relatedForHlr(id: string, index: CoverageIndex): RelatedItem[] {
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

function relatedForLlr(id: string, index: CoverageIndex): RelatedItem[] {
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

function relatedForTest(name: string, index: CoverageIndex): RelatedItem[] {
    const items: RelatedItem[] = [];
    // Walk every flat test we know about to find the matching <test>;
    // the lens caller already has the name from the regex.
    const test = findTestByName(index, name);
    for (const tr of test?.traces ?? []) {
        if (!tr.ref) {
            continue;
        }
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

function findTestByName(index: CoverageIndex, name: string): ParsedTest | undefined {
    // Tests are not indexed by name in the build pass (their identity
    // is `(file, name)`), but every related-trace map stores ParsedTest
    // values; scanning their union is fine for typical project sizes.
    for (const list of index.testsByLlr.values()) {
        const hit = list.find((t) => t.name === name);
        if (hit) {
            return hit;
        }
    }
    for (const list of index.testsByHlr.values()) {
        const hit = list.find((t) => t.name === name);
        if (hit) {
            return hit;
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------
// Summary text
// ---------------------------------------------------------------------

function summaryForHlr(related: RelatedItem[]): string {
    const llrs = related.filter((r) => r.description === 'LLR').length;
    const tests = related.filter((r) => r.description === 'test').length;
    return `${pluralize(llrs, 'LLR')} · ${pluralize(tests, 'test')}`;
}

function summaryForLlr(related: RelatedItem[]): string {
    const hlrs = related.filter((r) => r.description === 'HLR').length;
    const tests = related.filter((r) => r.description === 'test').length;
    return `${pluralize(hlrs, 'HLR')} · ${pluralize(tests, 'test')}`;
}

function summaryForTest(related: RelatedItem[]): string {
    const llrs = related.filter((r) => r.description === 'LLR').length;
    const hlrs = related.filter((r) => r.description === 'HLR').length;
    return `${pluralize(llrs, 'LLR')} · ${pluralize(hlrs, 'HLR')}`;
}

function pluralize(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------
// Lens emission
// ---------------------------------------------------------------------

function pushLenses(
    out: vscode.CodeLens[],
    range: vscode.Range,
    summary: string,
    pickerTitle: string,
    related: RelatedItem[],
): void {
    if (related.length === 0) {
        out.push(
            new vscode.CodeLens(range, {
                title: `${summary} — no coverage`,
                command: '',
            }),
        );
        return;
    }
    out.push(
        new vscode.CodeLens(range, {
            title: summary,
            command: PICK_RELATED_COMMAND,
            tooltip: `Show all related items for ${pickerTitle}`,
            arguments: [{ title: pickerTitle, items: related }],
        }),
    );
    const inline = related.slice(0, MAX_INLINE_LENSES);
    for (const item of inline) {
        out.push(
            new vscode.CodeLens(range, {
                title: `→ ${item.label}`,
                command: REVEAL_COMMAND,
                tooltip: `Reveal ${item.description ?? ''} ${item.label} in Project.xml`.trim(),
                arguments: [item.locator],
            }),
        );
    }
    if (related.length > MAX_INLINE_LENSES) {
        const overflow = related.length - MAX_INLINE_LENSES;
        out.push(
            new vscode.CodeLens(range, {
                title: `+${overflow} more…`,
                command: PICK_RELATED_COMMAND,
                arguments: [{ title: pickerTitle, items: related }],
            }),
        );
    }
}

// ---------------------------------------------------------------------
// Picker command (invoked by the summary / overflow lens)
// ---------------------------------------------------------------------

interface PickRelatedArg {
    readonly title: string;
    readonly items: RelatedItem[];
}

export async function pickRelatedAndReveal(arg: PickRelatedArg | undefined): Promise<void> {
    if (!arg || !arg.items || arg.items.length === 0) {
        return;
    }
    const items = arg.items.map((it) => ({
        label: it.label,
        description: it.description,
        locator: it.locator,
    }));
    const pick = await vscode.window.showQuickPick(items, {
        title: `Related to ${arg.title}`,
        placeHolder: 'Choose an element to reveal in Project.xml',
    });
    if (!pick) {
        return;
    }
    await vscode.commands.executeCommand(REVEAL_COMMAND, pick.locator);
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function isProjectXml(doc: vscode.TextDocument): boolean {
    const xmlPath = getProjectXmlPath();
    if (!xmlPath) {
        return false;
    }
    return doc.uri.fsPath === xmlPath;
}

function rangeAt(doc: vscode.TextDocument, offset: number): vscode.Range {
    const pos = doc.positionAt(offset);
    return new vscode.Range(pos.line, 0, pos.line, 0);
}

function* matchAll(text: string, re: RegExp): Generator<RegExpExecArray> {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
        yield m;
        if (m.index === re.lastIndex) {
            re.lastIndex++;
        }
    }
}

// ---------------------------------------------------------------------
// Phase 2.5b Slice F: schema-driven lens targets
// ---------------------------------------------------------------------

/**
 * Per-element coverage handler. Each entry knows how to enumerate
 * "related" items (LLRs, HLRs, tests) for one parsed element value
 * and how to summarise the result for the summary lens. The dispatch
 * table is the only payload-aware code path left in this provider --
 * the (element, id_attr) pairs scanned for lenses are derived from
 * `_ui_hints_index` at call time.
 */
type RelatedHandler = (value: string, index: CoverageIndex) => RelatedItem[];
type SummaryFn = (related: RelatedItem[]) => string;

interface LensTarget {
    readonly element: string;
    readonly idAttr: string;
    readonly label: string;
    readonly summary: SummaryFn;
}

/** Lens kinds that this provider knows how to render. */
const SUPPORTED_LENS_KINDS = new Set(['coverage', 'tracesCount']);

/** Maps the lowercase XML tag (UiHintEntry.element) to the per-element
 *  related-item lookup. Adding a fourth payload with a coverage lens
 *  in the schema is then a one-line registration here. */
const RELATED_DISPATCH: Record<string, RelatedHandler> = {
    hlr:  relatedForHlr,
    llr:  relatedForLlr,
    test: relatedForTest,
};

/** User-visible labels for each known element. */
const ELEMENT_LABELS: Record<string, string> = {
    hlr:  'HLR',
    llr:  'LLR',
    test: 'test',
};

/** Per-element summary text strategy. */
const SUMMARY_DISPATCH: Record<string, SummaryFn> = {
    hlr:  summaryForHlr,
    llr:  summaryForLlr,
    test: summaryForTest,
};

/**
 * Walk `_ui_hints_index` and return the ordered list of elements
 * whose schema annotations declare a supported lens kind. Falls back
 * to the legacy hard-coded HLR/LLR/Test triple when the sidecar did
 * not provide an index (older Python builds, or `parse_to_json`
 * failure paths that still return a partial result).
 *
 * Exported for tier-1 tests.
 */
export function getLensTargets(
    hints: UiHintsIndex | undefined,
): LensTarget[] {
    if (!hints) {
        return LEGACY_LENS_TARGETS;
    }
    const out: LensTarget[] = [];
    const seen = new Set<string>();
    for (const key of Object.keys(hints)) {
        const entry = hints[key];
        if (!entry?.element || !entry.tree_node) {
            continue;
        }
        const wanted = entry.lenses.some((l) => SUPPORTED_LENS_KINDS.has(l.kind));
        if (!wanted) {
            continue;
        }
        if (seen.has(entry.element)) {
            continue;
        }
        seen.add(entry.element);
        out.push({
            element: entry.element,
            idAttr:  entry.tree_node.id_attr || 'id',
            label:   ELEMENT_LABELS[entry.element]
                  ?? entry.element.toUpperCase(),
            summary: SUMMARY_DISPATCH[entry.element] ?? defaultSummary,
        });
    }
    return out.length > 0 ? out : LEGACY_LENS_TARGETS;
}

const LEGACY_LENS_TARGETS: LensTarget[] = [
    { element: 'hlr',  idAttr: 'id',   label: 'HLR',  summary: summaryForHlr  },
    { element: 'llr',  idAttr: 'id',   label: 'LLR',  summary: summaryForLlr  },
    { element: 'test', idAttr: 'name', label: 'test', summary: summaryForTest },
];

function defaultSummary(related: RelatedItem[]): string {
    return pluralize(related.length, 'related');
}

/** Exported for tier-1 tests. */
export const _RELATED_DISPATCH = RELATED_DISPATCH;
/** Exported for tier-1 tests. */
export const _SUPPORTED_LENS_KINDS = SUPPORTED_LENS_KINDS;

const ATTR_ESCAPE = /[.*+?^${}()|[\]\\]/g;

function buildElementIdRegex(element: string, idAttr: string): RegExp {
    const tag  = element.replace(ATTR_ESCAPE, '\\$&');
    const attr = idAttr.replace(ATTR_ESCAPE, '\\$&');
    return new RegExp(`<${tag}\\b[^>]*?\\b${attr}="([^"]+)"`, 'g');
}
