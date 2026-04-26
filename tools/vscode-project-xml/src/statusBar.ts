// Phase 6 (HLR-042): a status bar item showing the current
// `n errors / m warnings` count for Project.xml. Clicking opens
// the Problems panel filtered to the projectXml source.
//
// The status bar honours `projectXml.warningsAsErrors`: when true,
// warnings count toward the error total in the displayed text and
// the badge severity escalates. This NEVER hides or suppresses
// warnings — the underlying diagnostics remain unchanged; the
// status bar simply mirrors the user's chosen severity policy.

import * as vscode from 'vscode';
import { LintResult } from './sidecar';
import { getConfig, getProjectXmlPath } from './util/paths';

const COMMAND_SHOW_PROBLEMS = 'projectXml.showProblems';

export class LintStatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly disposables: vscode.Disposable[] = [];
    private latestErrors = 0;
    private latestWarnings = 0;
    private latestNotes = 0;

    constructor() {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            50,
        );
        this.item.command = COMMAND_SHOW_PROBLEMS;
        this.item.name = 'Project Spec';

        this.disposables.push(
            vscode.commands.registerCommand(COMMAND_SHOW_PROBLEMS, () =>
                this.showProblems(),
            ),
        );
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('projectXml.warningsAsErrors')) {
                    this.render();
                }
            }),
        );
        this.render();
        this.item.show();
    }

    /** Update from the latest LintResult (from LintDiagnosticsProvider.run()). */
    update(result: LintResult | undefined): void {
        if (!result) {
            this.latestErrors = 0;
            this.latestWarnings = 0;
            this.latestNotes = 0;
        } else {
            this.latestErrors = result.errors.length;
            this.latestWarnings = result.warnings.length;
            this.latestNotes = result.notes.length;
        }
        this.render();
    }

    private render(): void {
        const escalate = getConfig().get<boolean>('warningsAsErrors', false);
        // HLR-042: warnings are NEVER hidden. We always show both
        // counts verbatim. `warningsAsErrors` only escalates the
        // visual severity (icon + tooltip note) and the displayed
        // total — it does not silence anything.
        const errors = escalate
            ? this.latestErrors + this.latestWarnings
            : this.latestErrors;
        const warnings = escalate ? 0 : this.latestWarnings;

        let icon: string;
        if (errors > 0) {
            icon = '$(error)';
            this.item.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.errorBackground',
            );
        } else if (warnings > 0) {
            icon = '$(warning)';
            this.item.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground',
            );
        } else {
            icon = '$(check)';
            this.item.backgroundColor = undefined;
        }

        this.item.text = `${icon} Project Spec: ${errors} ${plural(errors, 'error')} / ${warnings} ${plural(warnings, 'warning')}`;

        const tooltip = new vscode.MarkdownString();
        tooltip.isTrusted = true;
        tooltip.appendMarkdown(`**Project Spec lint**\n\n`);
        tooltip.appendMarkdown(`- Errors: ${this.latestErrors}\n`);
        tooltip.appendMarkdown(`- Warnings: ${this.latestWarnings}\n`);
        tooltip.appendMarkdown(`- Notes: ${this.latestNotes}\n\n`);
        if (escalate) {
            tooltip.appendMarkdown(
                `_\`projectXml.warningsAsErrors\` is on; warnings counted as errors above. ` +
                `Warnings are still shown in the Problems panel verbatim (HLR-042)._\n\n`,
            );
        }
        tooltip.appendMarkdown(`Click to open the Problems panel.`);
        this.item.tooltip = tooltip;
    }

    private async showProblems(): Promise<void> {
        const xmlPath = getProjectXmlPath();
        if (xmlPath) {
            try {
                const doc = await vscode.workspace.openTextDocument(xmlPath);
                await vscode.window.showTextDocument(doc, { preview: false });
            } catch {
                // Best effort — fall through to the Problems panel.
            }
        }
        await vscode.commands.executeCommand('workbench.action.problems.focus');
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.item.dispose();
    }
}

function plural(n: number, word: string): string {
    return n === 1 ? word : `${word}s`;
}
