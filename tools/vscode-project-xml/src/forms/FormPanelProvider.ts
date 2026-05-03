// Phase 3: payload-agnostic form webview — thin wrapper delegating
// to formLogic.ts (humble object pattern, Phase 10).

import * as vscode from 'vscode';
import {
    ApplyEditResult,
    FormSchemaResult,
    ParsedNodesIndex,
    ProjectIoClient,
    UiFormField,
} from '../sidecar';
import { getProjectXmlPath } from '../util/paths';
import type { RevealLocator } from '../treeView/treeLogic';
import {
    buildOperations as _buildOperations,
    computeCoverage as _computeCoverage,
    CoverageInfo,
    escapeHtml,
    locatorFromBasePath,
    OpenFormParams,
    resolveFormParams as _resolveFormParams,
} from './formLogic';

// Re-export for backward compat (existing tests + commands).
export { buildOperations, computeCoverage, resolveFormParams } from './formLogic';
export type {
    FormPayloadKind,
    OpenFormParams,
    CoverageLink,
    CoverageLinkSection,
    CoverageInfo,
} from './formLogic';

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
            if (choice !== 'Save and Continue') { return; }
            await open.save();
        }

        const refs = await this.snapshotRefIds();
        let derived: FormSchemaResult;
        try {
            derived = await this.sidecar.formSchema({ type: params.type, refs });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            void vscode.window.showErrorMessage(`Project Spec: form_schema failed: ${msg}`);
            return;
        }

        let coverageInfo: CoverageInfo | undefined;
        if (params.basePath) {
            try {
                const parsed = await this.sidecar.parseToJson();
                coverageInfo = _computeCoverage(parsed, params.type, params.initial);
            } catch { /* Silently degrade */ }
        }

        const panel = vscode.window.createWebviewPanel(
            'projectXml.formPanel',
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
                        const formParams = _resolveFormParams(parsed, locator);
                        if (formParams) {
                            void this.open(formParams);
                        } else {
                            void vscode.window.showWarningMessage(
                                `Could not find ${locator.tag} "${locator.value}" in Project.xml.`,
                            );
                        }
                    } catch { /* Best-effort */ }
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
                if (msg?.type === 'cancel') { panel.dispose(); }
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
        const operations = _buildOperations(params, formData, fields);
        if (!operations.length) {
            panel.webview.postMessage({ type: 'result', ok: true, message: 'No changes to apply.' });
            return;
        }
        let result: ApplyEditResult;
        try {
            result = await this.sidecar.applyEdit({ operations });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            panel.webview.postMessage({ type: 'result', ok: false, message: `apply_edit failed: ${message}`, findings: null });
            return;
        }
        if (result.ok && result.written) {
            void vscode.commands.executeCommand('projectXml.refresh');
            panel.dispose();
            return;
        }
        panel.webview.postMessage({
            type: 'result', ok: false, findings: result.findings,
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
            const sddRefs = new Set<string>();
            for (const h of parsed.flat_hlrs ?? []) {
                for (const tr of h.traces ?? []) {
                    if (tr.target === 'SDD' && tr.ref) { sddRefs.add(tr.ref); }
                }
            }
            if (hlrs.length) { out.HLR = hlrs; }
            if (llrs.length) { out.LLR = llrs; }
            if (sddRefs.size) { out.SDD = [...sddRefs].sort(); }
            return out;
        } catch (err) {
            this.output.appendLine(
                `[form-panel] ref snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return {};
        }
    }
}

// ---------------------------------------------------------------------
// HTML rendering (VS Code API — stays here)
// ---------------------------------------------------------------------

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
          content="default-src \x27none\x27; img-src ${webview.cspSource} data:;
                   style-src ${webview.cspSource} \x27unsafe-inline\x27;
                   script-src \x27nonce-${nonce}\x27 \x27unsafe-eval\x27;" />
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
