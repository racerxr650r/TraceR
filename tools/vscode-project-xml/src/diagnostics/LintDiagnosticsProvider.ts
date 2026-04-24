// Mirrors lint findings from project_io.lint() into a
// vscode.DiagnosticCollection over Project.xml. Each finding string is
// passed through the locator (src/util/locator.ts) to compute a best-
// effort range; if the locator can't find a meaningful token the
// diagnostic is anchored to the top of the file so the user still sees
// it in the Problems panel.

import * as vscode from 'vscode';
import { ProjectIoClient, LintResult } from '../sidecar';
import { getProjectXmlPath, getProjectXmlUri, getXsdPath } from '../util/paths';
import { rangeForFinding } from '../util/locator';

const SOURCE = 'projectXml';

export class LintDiagnosticsProvider implements vscode.Disposable {
    private readonly collection: vscode.DiagnosticCollection;

    constructor(
        private readonly client: ProjectIoClient,
        private readonly outputChannel: vscode.OutputChannel,
    ) {
        this.collection = vscode.languages.createDiagnosticCollection(SOURCE);
    }

    async run(): Promise<LintResult | undefined> {
        const xmlPath = getProjectXmlPath();
        const xmlUri = getProjectXmlUri();
        if (!xmlPath || !xmlUri) {
            return undefined;
        }
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

        const diagnostics: vscode.Diagnostic[] = [];
        for (const msg of result.errors) {
            diagnostics.push(makeDiagnostic(doc, msg, vscode.DiagnosticSeverity.Error));
        }
        for (const msg of result.warnings) {
            diagnostics.push(makeDiagnostic(doc, msg, vscode.DiagnosticSeverity.Warning));
        }
        for (const msg of result.notes) {
            diagnostics.push(makeDiagnostic(doc, msg, vscode.DiagnosticSeverity.Information));
        }
        this.collection.set(uri, diagnostics);
    }

    clear(): void {
        this.collection.clear();
    }

    dispose(): void {
        this.collection.dispose();
    }
}

function makeDiagnostic(
    doc: vscode.TextDocument,
    message: string,
    severity: vscode.DiagnosticSeverity,
): vscode.Diagnostic {
    const diag = new vscode.Diagnostic(rangeForFinding(doc, message), message, severity);
    diag.source = SOURCE;
    return diag;
}
