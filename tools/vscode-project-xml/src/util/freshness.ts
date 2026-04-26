// Phase 6 (LLR-PKG-07, HLR-062): one-shot information notification
// at activation when the workspace's `tools/project.xsd`
// `schema_version` is older than the bundled
// `dist/python/.bundle_version`. Never an error or blocking modal.
//
// The workspace's tools/ remains authoritative for the sidecar
// spawn at all times — this only OFFERS to re-run the scaffolder.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    getBundledToolsDir,
    getConfig,
    getProjectFolder,
} from './paths';
import { SCAFFOLD_TOOLS_COMMAND } from '../commands/scaffoldTools';

/**
 * Run the freshness check exactly once. Surfaces a single
 * `showInformationMessage` when bundled > workspace, with a
 * `Re-scaffold tools/` action that invokes
 * `projectXml.scaffoldTools` with overwrite confirmed.
 */
export async function checkBundledToolsFreshness(
    output: vscode.OutputChannel,
): Promise<void> {
    try {
        const bundled = getBundledToolsDir();
        if (!bundled) {
            return;
        }
        const bundleVersionPath = path.join(bundled, '.bundle_version');
        if (!fs.existsSync(bundleVersionPath)) {
            return;
        }
        const bundledVersion = fs.readFileSync(bundleVersionPath, 'utf8').trim();
        if (!bundledVersion) {
            return;
        }

        const folder = getProjectFolder();
        if (!folder) {
            return;
        }
        const toolsRel = getConfig().get<string>('toolsDir') ?? 'tools';
        const wsXsd = path.isAbsolute(toolsRel)
            ? path.join(toolsRel, 'project.xsd')
            : path.join(folder.uri.fsPath, toolsRel, 'project.xsd');
        if (!fs.existsSync(wsXsd)) {
            // No workspace XSD pin — nothing to compare. Don't nag.
            return;
        }
        const wsVersion = readSchemaVersion(wsXsd);
        if (!wsVersion) {
            return;
        }
        if (compareVersions(bundledVersion, wsVersion) <= 0) {
            return;
        }

        output.appendLine(
            `[freshness] bundled tools/ version ${bundledVersion} > workspace ${wsVersion}`,
        );
        const choice = await vscode.window.showInformationMessage(
            `Project Spec: the bundled tools/ in this extension is newer ` +
            `(schema_version ${bundledVersion}) than your workspace's ` +
            `(${wsVersion}). Re-scaffold to update?`,
            'Re-scaffold tools/',
            'Dismiss',
        );
        if (choice === 'Re-scaffold tools/') {
            await vscode.commands.executeCommand(SCAFFOLD_TOOLS_COMMAND, {
                overwrite: true,
            });
        }
    } catch (err) {
        // Never let the freshness check escalate.
        const msg = err instanceof Error ? err.message : String(err);
        output.appendLine(`[freshness] check failed (non-fatal): ${msg}`);
    }
}

/** Pull `version` from the XSD root `<xs:schema ...>` element. */
function readSchemaVersion(xsdPath: string): string | undefined {
    const text = fs.readFileSync(xsdPath, 'utf8');
    const m = text.match(/<xs:schema\b[^>]*\sversion\s*=\s*"([^"]+)"/);
    return m ? m[1] : undefined;
}

/** Compare two dotted version strings; returns -1/0/+1. */
export function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map((s) => parseInt(s, 10) || 0);
    const pb = b.split('.').map((s) => parseInt(s, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
        const da = pa[i] ?? 0;
        const db = pb[i] ?? 0;
        if (da > db) return 1;
        if (da < db) return -1;
    }
    return 0;
}
