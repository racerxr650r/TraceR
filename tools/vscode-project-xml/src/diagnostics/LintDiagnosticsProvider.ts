// Mirrors lint findings from project_io.lint() into a
// vscode.DiagnosticCollection over Project.xml. Each finding string is
// passed through the locator (src/util/locator.ts) to compute a best-
// effort range; if the locator can't find a meaningful token the
// diagnostic is anchored to the top of the file so the user still sees
// it in the Problems panel.

import * as vscode from 'vscode';
import { ProjectIoClient, LintResult, UiHintsIndex } from '../sidecar';
import { getProjectXmlPath, getProjectXmlUri, getXsdPath } from '../util/paths';
import {
    DEFAULT_ID_SCAN_REGISTRY,
    IdScanEntry,
    buildIdScanRegistryFromHints,
    rangeForFinding,
} from '../util/locator';
import {
    DIAGNOSTIC_SOURCE,
    resultToDescriptors,
    SeverityLevel,
} from './lintMapping';

export { DIAGNOSTIC_SOURCE as SOURCE } from './lintMapping';

const VSCODE_SEVERITY: Record<SeverityLevel, vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    info: vscode.DiagnosticSeverity.Information,
};

export class LintDiagnosticsProvider implements vscode.Disposable {
    private readonly collection: vscode.DiagnosticCollection;
    /** Cached schema-derived id-scan registry. Populated on first
     *  successful `ui_hints_index` call; falls back to the legacy
     *  HLR/LLR pair when the sidecar can't supply hints. */
    private idScanRegistry: IdScanEntry[] = DEFAULT_ID_SCAN_REGISTRY;
    private hintsLoaded = false;

    constructor(
        private readonly client: ProjectIoClient,
        private readonly outputChannel: vscode.OutputChannel,
    ) {
        this.collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
    }

    async run(): Promise<LintResult | undefined> {
        const xmlPath = getProjectXmlPath();
        const xmlUri = getProjectXmlUri();
        if (!xmlPath || !xmlUri) {
            return undefined;
        }
        await this.ensureHints();
        const xsdPath = getXsdPath();
        const params: Record<string, unknown> = { xml_path: xmlPath };
        if (xsdPath) {
            params.xsd_path = xsdPath;
        }
        let result: LintResult;
        try {
            result = await this.client.lint(params);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.outputChannel.appendLine(`[lint] failed: ${message}`);
            this.collection.set(xmlUri, [
                new vscode.Diagnostic(
                    new vscode.Range(0, 0, 0, 0),
                    `lint failed: ${message}`,
                    vscode.DiagnosticSeverity.Error,
                ),
            ]);
            return undefined;
        }
        await this.publish(xmlUri, result);
        return result;
    }

    private async publish(uri: vscode.Uri, result: LintResult): Promise<void> {
        let doc: vscode.TextDocument;
        try {
            doc = await vscode.workspace.openTextDocument(uri);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.outputChannel.appendLine(`[lint] could not open ${uri.fsPath}: ${message}`);
            return;
        }

        const descriptors = resultToDescriptors(result);
        const diagnostics = descriptors.map((d) => {
            const diag = new vscode.Diagnostic(
                rangeForFinding(doc, d.message, this.idScanRegistry),
                d.message,
                VSCODE_SEVERITY[d.severity],
            );
            diag.source = DIAGNOSTIC_SOURCE;
            if (d.code) {
                diag.code = d.code;
            }
            return diag;
        });
        this.collection.set(uri, diagnostics);
    }
    /**
     * Phase 2.5b Slice G: pull `_ui_hints_index` from the sidecar on
     * first use and derive a payload-aware id-scan registry from it.
     * Falls back silently to the legacy HLR/LLR pair when the call
     * fails (older sidecar, transient error). Re-fetched once per
     * provider lifetime; refresh on workspace reload.
     */
    private async ensureHints(): Promise<void> {
        if (this.hintsLoaded) {
            return;
        }
        this.hintsLoaded = true;
        try {
            const resp = await this.client.uiHintsIndex();
            const hints = resp.ui_hints_index as unknown as UiHintsIndex;
            this.idScanRegistry = buildIdScanRegistryFromHints(hints);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.outputChannel.appendLine(
                `[lint] ui_hints_index unavailable, using legacy id scan: ${message}`,
            );
        }
    }
    clear(): void {
        this.collection.clear();
    }

    dispose(): void {
        this.collection.dispose();
    }
}
