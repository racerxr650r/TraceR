// Phase 3: payload-agnostic form webview that edits a single <hlr>
// or <llr> using react-jsonschema-form, driven by a JSON Schema
// derived at runtime from the XSD subtree + ui:form hints.
//
// The webview HTML hosts a small React + RJSF bundle (built by the
// second esbuild entry — see esbuild.config.js). All schema
// derivation, ref-id snapshots, and persistence happen in the
// extension host so the webview itself stays small and stateless.
//
// Lifecycle:
//
//   1. Caller resolves a parsed XML node (or "blank" for addHlr /
//      addLlr) and invokes openFormPanel().
//   2. The panel asks the sidecar for {schema, uiSchema} and an id
//      snapshot for ref-target population.
//   3. The webview posts a `submit` message back with the new
//      formData; the panel computes a JSON Patch (one big `add` for
//      new elements, a sequence of attribute/text replaces for edits)
//      and hands it to ProjectIoClient.applyEdit().
//   4. On success the panel closes; on validation failure it forwards
//      the findings back to the webview which renders them inline.

import * as vscode from 'vscode';
import {
    ApplyEditResult,
    EditOperation,
    FormSchemaResult,
    ParsedNodesIndex,
    ParsedProject,
    ParsedSection,
    ParsedLlrGroup,
    ParsedTestFile,
    ProjectIoClient,
    UiFormField,
} from '../sidecar';
import { getProjectXmlPath } from '../util/paths';
import { RevealLocator } from '../treeView/ProjectSpecProvider';
import { buildCoverageIndex, CoverageIndex } from '../treeView/coverageTooltips';

/**
 * Phase 3 shipped HLR/LLR; Phase 4 widens this to any complex-type
 * name in the XSD's `ui_hints_index` (e.g. `"SddModule"`, `"Test"`,
 * `"TestFile"`, `"StpFixture"`). Anything the sidecar's
 * `form_schema` can derive is fair game.
 */
export type FormPayloadKind = string;

export interface OpenFormParams {
    /** Which UI hint complex type we're editing. */
    type: FormPayloadKind;
    /** Existing form data (from a parsed node) or the seed for a new
     *  element when adding. */
    initial: Record<string, unknown>;
    /** When supplied, the panel runs in edit mode and emits replace
     *  operations against this base path. When omitted, the panel
     *  runs in add mode and emits a single `add` op against
     *  `appendPath`. */
    basePath?: string;
    /** Append slot path (e.g. `/hlrs/section[number=1]/hlr/-`) — only
     *  used when basePath is omitted. */
    appendPath?: string;
    /** Window title shown above the form. */
    title: string;
}

const PANEL_VIEW_TYPE = 'projectXml.formPanel';

/** A single clickable trace link shown in the form panel's coverage section. */
export interface CoverageLink {
    label: string;
    sublabel?: string;
    tag: string;
    attr?: string;
    value: string;
}

/** A group of related trace links under a heading. */
export interface CoverageLinkSection {
    heading: string;
    items: CoverageLink[];
}

/** Read-only traceability summary sent to the form webview. */
export interface CoverageInfo {
    summary: string;
    sections: CoverageLinkSection[];
}

export class FormPanelProvider {
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly sidecar: ProjectIoClient,
        private readonly output: vscode.OutputChannel,
    ) {}

    async open(params: OpenFormParams): Promise<void> {
        const xmlPath = getProjectXmlPath();
        if (!xmlPath) {
            void vscode.window.showErrorMessage(
                'Project Spec: doc/Project.xml not found in workspace.',
            );
            return;
        }
        // Dirty-buffer check (HLR-018: never write through stale state).
        const open = vscode.workspace.textDocuments.find(
            (d) => d.uri.fsPath === xmlPath && d.isDirty,
        );
        if (open) {
            const choice = await vscode.window.showWarningMessage(
                'Project.xml has unsaved changes in the editor. Save before applying form edits?',
                { modal: true },
                'Save and Continue',
                'Cancel',
            );
            if (choice !== 'Save and Continue') {
                return;
            }
            await open.save();
        }

        const refs = await this.snapshotRefIds();
        let derived: FormSchemaResult;
        try {
            derived = await this.sidecar.formSchema({
                type: params.type,
                refs,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            void vscode.window.showErrorMessage(
                `Project Spec: form_schema failed: ${msg}`,
            );
            return;
        }

        // Coverage info is best-effort; a failure here must not block
        // the form from opening.
        let coverageInfo: CoverageInfo | undefined;
        if (params.basePath) {
            try {
                const parsed = await this.sidecar.parseToJson();
                coverageInfo = computeCoverage(parsed, params.type, params.initial);
            } catch {
                // Silently degrade — the form opens without the hint.
            }
        }

        const panel = vscode.window.createWebviewPanel(
            PANEL_VIEW_TYPE,
            params.title,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
                    vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                ],
            },
        );

        panel.webview.html = renderFormHtml(
            panel.webview,
            this.context.extensionUri,
            params.title,
        );

        panel.webview.onDidReceiveMessage(
            async (msg) => {
                if (msg?.type === 'ready') {
                    panel.webview.postMessage({
                        type: 'init',
                        title: params.title,
                        schema: derived.schema,
                        uiSchema: derived.uiSchema,
                        formData: params.initial,
                        canReveal: !!params.basePath,
                        coverageInfo,
                    });
                    return;
                }
                if (msg?.type === 'submit') {
                    await this.onSubmit(panel, params, derived.fields, msg.formData);
                    return;
                }
                if (msg?.type === 'reveal') {
                    const locator: RevealLocator | undefined =
                        msg.locator ?? locatorFromBasePath(params.basePath);
                    if (locator) {
                        void vscode.commands.executeCommand('projectXml.revealInXml', locator);
                    }
                    return;
                }
                if (msg?.type === 'openForm') {
                    const locator: RevealLocator | undefined = msg.locator;
                    if (!locator) { return; }
                    try {
                        const parsed = await this.sidecar.parseToJson();
                        const formParams = resolveFormParams(parsed, locator);
                        if (formParams) {
                            void this.open(formParams);
                        } else {
                            void vscode.window.showWarningMessage(
                                `Could not find ${locator.tag} "${locator.value}" in Project.xml.`,
                            );
                        }
                    } catch {
                        // Best-effort; silently ignore parse failures.
                    }
                    return;
                }
                if (msg?.type === 'openFile') {
                    const filePath = msg.path;
                    if (typeof filePath !== 'string' || !filePath) { return; }
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (!workspaceFolders?.length) { return; }
                    const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
                    void vscode.window.showTextDocument(uri, { preview: true });
                    return;
                }
                if (msg?.type === 'cancel') {
                    panel.dispose();
                }
            },
            undefined,
            this.context.subscriptions,
        );
    }

    private async onSubmit(
        panel: vscode.WebviewPanel,
        params: OpenFormParams,
        fields: UiFormField[],
        formData: Record<string, unknown>,
    ): Promise<void> {
        const operations = buildOperations(params, formData, fields);
        if (!operations.length) {
            panel.webview.postMessage({
                type: 'result',
                ok: true,
                message: 'No changes to apply.',
            });
            return;
        }
        let result: ApplyEditResult;
        try {
            result = await this.sidecar.applyEdit({ operations });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            panel.webview.postMessage({
                type: 'result', ok: false,
                message: `apply_edit failed: ${message}`,
                findings: null,
            });
            return;
        }
        if (result.ok && result.written) {
            void vscode.commands.executeCommand('projectXml.refresh');
            panel.dispose();
            return;
        }
        panel.webview.postMessage({
            type: 'result',
            ok: false,
            findings: result.findings,
            message: 'Validation failed; doc/Project.xml was left unchanged.',
        });
    }

    private async snapshotRefIds(): Promise<Record<string, string[]>> {
        try {
            const parsed = await this.sidecar.parseToJson();
            const nodes = (parsed as unknown as { _nodes?: ParsedNodesIndex })._nodes ?? {};
            const out: Record<string, string[]> = {};
            const hlrs = (nodes.Hlr ?? [])
                .map((n) => n.attrs?.id)
                .filter((id): id is string => typeof id === 'string' && id.length > 0);
            const llrs = (nodes.Llr ?? [])
                .map((n) => n.attrs?.id)
                .filter((id): id is string => typeof id === 'string' && id.length > 0);
            // SDD refs are template-derived section numbers (e.g. "3",
            // "2.2"), not module paths. Collect the unique set already
            // used across all HLR traces so the dropdown stays valid.
            const sddRefs = new Set<string>();
            for (const h of parsed.flat_hlrs ?? []) {
                for (const tr of h.traces ?? []) {
                    if (tr.target === 'SDD' && tr.ref) {
                        sddRefs.add(tr.ref);
                    }
                }
            }
            if (hlrs.length) {
                out.HLR = hlrs;
            }
            if (llrs.length) {
                out.LLR = llrs;
            }
            if (sddRefs.size) {
                out.SDD = [...sddRefs].sort();
            }
            return out;
        } catch (err) {
            this.output.appendLine(
                `[form-panel] ref snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return {};
        }
    }
}

/**
 * Build the read-only coverage info for the element being edited.
 * Returns `undefined` when the element type has no meaningful
 * traceability surface (e.g. unknown type, or missing id/name).
 *
 * Exported for unit tests.
 */
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
            items: llrs.map((l) => ({
                label: l.id,
                tag: 'llr',
                value: l.id,
            })),
        });
    }
    if (tests.length) {
        sections.push({
            heading: 'Direct tests',
            items: tests.map((t) => ({
                label: t.name,
                sublabel: t.file,
                tag: 'test',
                attr: 'name',
                value: t.name,
            })),
        });
    }
    return {
        summary: `${plural(llrs.length, 'LLR')} · ${plural(tests.length, 'test')}`,
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
            items: tests.map((t) => ({
                label: t.name,
                sublabel: t.file,
                tag: 'test',
                attr: 'name',
                value: t.name,
            })),
        });
    }
    return {
        summary: `${plural(upstream.length, 'HLR trace')} · ${plural(tests.length, 'test')}`,
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
            hlrLinks.push({
                label: tr.ref,
                sublabel: hlr?.name,
                tag: 'hlr',
                value: tr.ref,
            });
        } else if (tr.target === 'LLR') {
            llrLinks.push({
                label: tr.ref,
                tag: 'llr',
                value: tr.ref,
            });
        }
    }
    const sections: CoverageLinkSection[] = [];
    if (hlrLinks.length) {
        sections.push({ heading: 'Upstream HLRs', items: hlrLinks });
    }
    if (llrLinks.length) {
        sections.push({ heading: 'Upstream LLRs', items: llrLinks });
    }
    if (test?.file) {
        sections.push({
            heading: 'Source file',
            items: [{ label: test.file, tag: 'file', value: test.file }],
        });
    }
    return {
        summary: `${plural(hlrLinks.length, 'HLR')} · ${plural(llrLinks.length, 'LLR')}`,
        sections,
    };
}

function sddCoverage(path: string, parsed: ParsedProject): CoverageInfo | undefined {
    if (!path) { return undefined; }
    // Find HLRs that trace to this SDD section.
    const flatHlrs = parsed.flat_hlrs ?? collectHlrsFlat(parsed);
    const hlrLinks: CoverageLink[] = [];
    for (const hlr of flatHlrs) {
        for (const tr of hlr.traces ?? []) {
            if (tr.target === 'SDD' && tr.ref === path) {
                hlrLinks.push({
                    label: hlr.id,
                    sublabel: hlr.name,
                    tag: 'hlr',
                    value: hlr.id,
                });
                break; // One link per HLR, even if it traces multiple times.
            }
        }
    }
    const sections: CoverageLinkSection[] = [];
    if (hlrLinks.length) {
        sections.push({ heading: 'HLRs tracing to this module', items: hlrLinks });
    }
    return {
        summary: `${plural(hlrLinks.length, 'HLR')}`,
        sections,
    };
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

/**
 * Resolve a coverage-link locator to {@link OpenFormParams} by
 * looking up the matching item in the parsed project. Returns
 * `undefined` when the item cannot be found (e.g. stale link).
 *
 * Exported for unit tests.
 */
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

/**
 * Derive a {@link RevealLocator} from a basePath like
 * `/hlrs/section[number=1]/hlr[id=HLR-001]` by extracting the
 * last segment's tag name and bracketed attribute.
 */
function locatorFromBasePath(basePath: string | undefined): RevealLocator | undefined {
    if (!basePath) {
        return undefined;
    }
    // Match the last path segment: tag[attr=value]
    const m = basePath.match(/\/(\w+)\[(\w+)=([^\]]+)\]\s*$/);
    if (!m) {
        return undefined;
    }
    const [, tag, attr, value] = m;
    return attr === 'id'
        ? { tag, value }
        : { tag, attr, value };
}


/**
 * Compute the JSON Patch operations the form submission produces.
 *
 * - Add mode (no basePath, has appendPath): a single `add` op whose
 *   value is the form payload translated into the {@-attr / child}
 *   convention apply_edit expects.
 * - Edit mode (has basePath): one `replace` per attribute and one
 *   `replace` per child element body (text/CDATA), plus a wholesale
 *   `<traces>` rewrite when the trace list changed.
 *
 * `fields` comes from the sidecar's `form_schema` derivation — each
 * entry's `kind` distinguishes attribute (`'attr'`) from child
 * element (`'child'`). When omitted (legacy callers / tests), we
 * fall back to the Phase 3 hard-coded `id`/`name` heuristic so the
 * existing HLR/LLR contract is unaffected.
 */
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
        if (value === undefined) {
            continue;
        }
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
            // Defer @id to the end so earlier ops still resolve against
            // the original id in the basePath predicate.
            if (key === 'id') {
                idOp = op;
            } else {
                ops.push(op);
            }
            continue;
        }
        // Plain text body.
        ops.push({
            op: 'replace',
            path: `${basePath}/${key}`,
            value: value ?? '',
        });
    }
    if (idOp) {
        ops.push(idOp);
    }
    return ops;
}

function toElementSpec(
    formData: Record<string, unknown>,
    isAttribute: (key: string) => boolean,
): Record<string, unknown> {
    const spec: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(formData)) {
        if (value === undefined) {
            continue;
        }
        if (isAttribute(key)) {
            spec[`@${key}`] = String(value ?? '');
            continue;
        }
        if (key === 'traces') {
            const list = tracesToList(value);
            if (list.length) {
                spec.traces = { trace: list };
            }
            continue;
        }
        spec[key] = value;
    }
    return spec;
}

function tracesToList(value: unknown): Array<Record<string, string>> {
    if (!Array.isArray(value)) {
        return [];
    }
    const out: Array<Record<string, string>> = [];
    for (const row of value) {
        if (!row || typeof row !== 'object') {
            continue;
        }
        const r = row as Record<string, unknown>;
        if (!r.target || !r.ref) {
            continue;
        }
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

// Schema-driven attribute predicate. The Phase 3 fallback (`id` /
// `name`) keeps existing tests and any callers that don't pass a
// hint registry working as before.
function makeAttributeLookup(
    fields: ReadonlyArray<UiFormField> | undefined,
): (key: string) => boolean {
    if (!fields || fields.length === 0) {
        return (key) => key === 'id' || key === 'name';
    }
    const attrs = new Set<string>();
    for (const f of fields) {
        if (f.kind === 'attr') {
            attrs.add(f.target);
        }
    }
    return (key) => attrs.has(key);
}

function isAttribute(_key: string): boolean {
    // Retained as a no-op anchor so older imports keep building; the
    // real logic now lives in `makeAttributeLookup` and is threaded
    // through `buildOperations`. New code should not call this.
    return false;
}
void isAttribute;



function renderFormHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    title: string,
): string {
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'formPanel.js'),
    );
    const nonce = makeNonce();
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; img-src ${webview.cspSource} data:;
                   style-src ${webview.cspSource} 'unsafe-inline';
                   script-src 'nonce-${nonce}' 'unsafe-eval';" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: var(--vscode-font-family); padding: 1rem; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
      h1 { font-size: 1.1rem; margin: 0 0 1rem 0; }
      .field { display: flex; flex-direction: column; margin-bottom: 0.75rem; }
      .field > label { font-weight: 600; margin-bottom: 0.25rem; }
      input[type=text], textarea, select { font: inherit; padding: 0.4rem; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); }
      textarea { min-height: 8rem; font-family: var(--vscode-editor-font-family); }
      button { font: inherit; padding: 0.4rem 1rem; margin-right: 0.5rem; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; cursor: pointer; }
      button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
      .findings { margin-top: 1rem; padding: 0.5rem; background: var(--vscode-inputValidation-errorBackground, rgba(255,0,0,0.08)); border: 1px solid var(--vscode-inputValidation-errorBorder, #c00); }
      .findings ul { margin: 0.25rem 0 0 1.25rem; }
      .traces-row { display: grid; grid-template-columns: 6rem 1fr 1fr auto; gap: 0.5rem; margin-bottom: 0.4rem; }
      .coverage-section { margin-bottom: 1rem; padding: 0.75rem; background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.1)); border-left: 3px solid var(--vscode-textLink-foreground, #3794ff); }
      .coverage-summary { font-weight: 600; margin-bottom: 0.5rem; }
      .coverage-group { margin-bottom: 0.4rem; }
      .coverage-list { margin: 0.2rem 0 0 1.25rem; padding: 0; }
      .coverage-link { color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; text-decoration: none; }
      .coverage-link:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <div id="root">Loading…</div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

function makeNonce(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 24; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c] as string));
}
