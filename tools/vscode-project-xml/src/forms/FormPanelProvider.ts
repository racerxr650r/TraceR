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
    ProjectIoClient,
    UiFormField,
} from '../sidecar';
import { getProjectXmlPath } from '../util/paths';

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
                    });
                    return;
                }
                if (msg?.type === 'submit') {
                    await this.onSubmit(panel, params, derived.fields, msg.formData);
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
            if (hlrs.length) {
                out.HLR = hlrs;
            }
            if (llrs.length) {
                out.LLR = llrs;
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
            ops.push({
                op: 'replace',
                path: `${basePath}/@${key}`,
                value: String(value ?? ''),
            });
            continue;
        }
        // Plain text body.
        ops.push({
            op: 'replace',
            path: `${basePath}/${key}`,
            value: value ?? '',
        });
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
                   script-src 'nonce-${nonce}';" />
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
