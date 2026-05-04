// UI integration tests for editor-centric features.
//
// Verifies that:
//   * "Reveal in Project.xml" opens the file and selects the element;
//   * the lint status bar item shows error/warning counts;
//   * lint diagnostics appear in the Problems panel;
//   * code lenses appear on HLR/LLR elements in Project.xml.
//
// Traces: LLR-RVX-01, LLR-RVX-02, LLR-PKG-08, LLR-LDP-01, LLR-CCL-01, LLR-CCL-02

import { expect } from 'chai';
import * as path from 'path';
import {
    ActivityBar,
    BottomBarPanel,
    EditorView,
    StatusBar,
    TextEditor,
    VSBrowser,
    WebDriver,
} from 'vscode-extension-tester';
import {
    dismissWelcomeOverlay,
    expandGroup,
    getProjectSpecSection,
    retryOnStale,
    waitForEditorTab,
    waitForTreeItem,
} from './helpers';

const FIXTURE_WORKSPACE = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'test',
    'ui',
    'fixtures',
);

describe('Editor, status bar, and diagnostics (UI)', function () {
    this.timeout(120_000);
    this.retries(2);
    let driver: WebDriver;

    before(async function () {
        driver = VSBrowser.instance.driver;
        await VSBrowser.instance.openResources(FIXTURE_WORKSPACE);
        // Dismiss the VS Code onboarding overlay that blocks clicks in CI.
        await dismissWelcomeOverlay(driver);
        // Open the Project Spec view so tree-dependent tests can
        // navigate to leaves for Reveal commands.
        const activityBar = new ActivityBar();
        const viewControl = await activityBar.getViewControl('TraceR');
        if (viewControl) {
            await viewControl.openView();
        }
        // Wait until the tree has real groups before starting tests.
        // Polling replaces fixed sleeps.
        const section = await getProjectSpecSection();
        await expandGroup(section, 'HLRs');
    });

    afterEach(async function () {
        try {
            const dialog = await driver.findElements({
                css: '.monaco-dialog-box',
            });
            if (dialog.length > 0) {
                const buttons = await driver.findElements({
                    css: '.monaco-dialog-box .dialog-buttons a.monaco-button',
                });
                for (const btn of buttons) {
                    const label = await btn.getText();
                    if (
                        label.includes("Don't Save") ||
                        label.includes('No') ||
                        label.includes('Cancel')
                    ) {
                        await btn.click();
                        await driver.sleep(500);
                        break;
                    }
                }
            }
        } catch {
            // no dialog
        }
        try {
            await new EditorView().closeAllEditors();
        } catch {
            // best-effort
        }
        // Close the bottom bar if open
        try {
            const bottomBar = new BottomBarPanel();
            await bottomBar.toggle(false);
        } catch {
            // not open
        }
    });

    // ── Reveal in XML ────────────────────────────────────────────

    it('Reveal in XML opens Project.xml with HLR element selected', async function () {
        const section = await getProjectSpecSection();
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        const hlrLeaf = await waitForTreeItem(section, 'HLR-T01 Sample HLR');
        const menu = await retryOnStale(() => hlrLeaf.openContextMenu());
        const revealItem = await menu.getItem(
            'Project Spec: Reveal in Project.xml',
        );
        expect(revealItem).to.not.be.undefined;
        await revealItem!.select();
        // Poll until Project.xml tab opens
        await waitForEditorTab((t) => t.includes('Project.xml'));
        // Verify the selected text includes the HLR id
        const editor = new TextEditor();
        const selectedText = await editor.getSelectedText();
        expect(selectedText).to.include('HLR-T01');
    });

    // ── Status bar ───────────────────────────────────────────────

    it('status bar shows TraceR lint summary', async function () {
        // Poll for the status bar item — it may take a moment for the
        // linter to complete and update the status bar in CI.
        const deadline = Date.now() + 15_000;
        let found: string | undefined;
        while (Date.now() < deadline && !found) {
            const statusBar = new StatusBar();
            const items = await statusBar.getItems();
            for (const item of items) {
                try {
                    const text = await item.getText();
                    if (text.includes('TraceR')) {
                        found = text;
                        break;
                    }
                } catch {
                    // some items may not have accessible text
                }
            }
            if (!found) {
                await new Promise((r) => setTimeout(r, 500));
            }
        }
        expect(
            found,
            'Expected a status bar item containing "TraceR"',
        ).to.not.be.undefined;
        expect(found).to.match(/\d+\s+error/);
    });

    // ── Problems panel ───────────────────────────────────────────

    it('Problems panel shows lint findings for coverage gaps', async function () {
        const bottomBar = new BottomBarPanel();
        await bottomBar.toggle(true);
        const problemsView = await bottomBar.openProblemsView();
        // Poll for findings instead of fixed sleep
        const deadline = Date.now() + 15_000;
        let hasFindings = false;
        while (Date.now() < deadline && !hasFindings) {
            try {
                const badge = await problemsView.getCountBadge();
                const text = await badge.getText();
                hasFindings = parseInt(text, 10) > 0;
            } catch {
                // No badge element = 0 problems yet
            }
            if (!hasFindings) {
                await new Promise((r) => setTimeout(r, 500));
            }
        }
        expect(
            hasFindings,
            'Expected at least one lint finding (HLR-T02 coverage gap)',
        ).to.be.true;
        await bottomBar.toggle(false);
    });

    // ── Code lenses ──────────────────────────────────────────────

    it('code lenses appear on HLR elements in Project.xml', async function () {
        // Open Project.xml via tree's Reveal command
        const section = await getProjectSpecSection();
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        const hlrLeaf = await waitForTreeItem(section, 'HLR-T01 Sample HLR');
        const menu = await retryOnStale(() => hlrLeaf.openContextMenu());
        const revealItem = await menu.getItem(
            'Project Spec: Reveal in Project.xml',
        );
        await revealItem!.select();
        await waitForEditorTab((t) => t.includes('Project.xml'));
        // Poll for code lenses to appear (they load asynchronously)
        const editor = new TextEditor();
        const lensDeadline = Date.now() + 15_000;
        let lenses: Awaited<ReturnType<TextEditor['getCodeLenses']>> = [];
        while (Date.now() < lensDeadline) {
            lenses = await editor.getCodeLenses();
            if (lenses.length > 0) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        expect(lenses.length).to.be.greaterThan(
            0,
            'Expected coverage code lenses on HLR elements',
        );
        // Verify at least one lens contains coverage info
        const lensTexts: string[] = [];
        for (const lens of lenses) {
            try {
                const text = await lens.getText();
                lensTexts.push(text);
            } catch {
                // some lenses may not have accessible text
            }
        }
        const hasCoverageLens = lensTexts.some(
            (t) =>
                t.includes('LLR') ||
                t.includes('test') ||
                t.includes('coverage'),
        );
        expect(
            hasCoverageLens,
            `Expected a coverage code lens, got: ${lensTexts}`,
        ).to.be.true;
    });
});
