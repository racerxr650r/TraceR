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
    CustomTreeSection,
    EditorView,
    SideBarView,
    StatusBar,
    TextEditor,
    VSBrowser,
    WebDriver,
} from 'vscode-extension-tester';
import { dismissWelcomeOverlay } from './helpers';

const FIXTURE_WORKSPACE = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'test',
    'ui',
    'fixtures',
);

/**
 * Poll until a tree group whose label starts with `prefix` appears in
 * the TraceR section. Used in `before()` to ensure the sidecar has
 * finished parsing before tests run.
 */
async function waitForTreeGroup(
    prefix: string,
    timeout = 30_000,
): Promise<void> {
    const sidebar = new SideBarView();
    const deadline = Date.now() + timeout;
    let lastLabels: string[] = [];
    let sectionFound = false;
    while (Date.now() < deadline) {
        try {
            const section = (await sidebar
                .getContent()
                .getSection('TraceR')) as CustomTreeSection;
            sectionFound = true;
            const items = await section.getVisibleItems();
            lastLabels = [];
            for (const item of items) {
                const label = await item.getLabel();
                lastLabels.push(label);
                if (label.startsWith(prefix)) {
                    return;
                }
            }
        } catch {
            // section may not exist yet
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(
        `Tree group "${prefix}" not found within ${timeout}ms. ` +
        `Section found: ${sectionFound}. ` +
        `Visible items: [${lastLabels.join(', ')}]`,
    );
}

describe('Editor, status bar, and diagnostics (UI)', function () {
    this.timeout(120_000);
    let driver: WebDriver;

    before(async function () {
        driver = VSBrowser.instance.driver;
        await VSBrowser.instance.openResources(FIXTURE_WORKSPACE);
        await driver.sleep(8000);
        // Dismiss the VS Code onboarding overlay that blocks clicks in CI.
        await dismissWelcomeOverlay(driver);
        // Open the Project Spec view so tree-dependent tests can
        // navigate to leaves for Reveal commands.
        const activityBar = new ActivityBar();
        const viewControl = await activityBar.getViewControl('TraceR');
        if (viewControl) {
            await viewControl.openView();
        }
        await driver.sleep(3000);
        // Wait until the tree has real groups before starting tests.
        // In CI the sidecar may take longer to parse.
        await waitForTreeGroup('HLRs', 30_000);
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
        const sidebar = new SideBarView();
        const section = (await sidebar
            .getContent()
            .getSection('TraceR')) as CustomTreeSection;
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        await driver.sleep(1000);
        const hlrLeaf = await section.findItem('HLR-T01 Sample HLR');
        expect(hlrLeaf).to.not.be.undefined;
        const menu = await hlrLeaf!.openContextMenu();
        const revealItem = await menu.getItem(
            'Project Spec: Reveal in Project.xml',
        );
        expect(revealItem).to.not.be.undefined;
        await revealItem!.select();
        await driver.sleep(2000);
        // Verify Project.xml is open in the editor
        const editorView = new EditorView();
        const titles = await editorView.getOpenEditorTitles();
        expect(titles.some((t) => t.includes('Project.xml'))).to.be.true;
        // Verify the selected text includes the HLR id
        const editor = new TextEditor();
        const selectedText = await editor.getSelectedText();
        expect(selectedText).to.include('HLR-T01');
    });

    // ── Status bar ───────────────────────────────────────────────

    it('status bar shows TraceR lint summary', async function () {
        const statusBar = new StatusBar();
        // The extension adds a status bar item with text like
        // "$(icon) TraceR: N errors / M warnings".
        // StatusBar.getItem matches by partial aria-label, so search
        // through all items for our text.
        const items = await statusBar.getItems();
        let found: string | undefined;
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
        await driver.sleep(2000);
        // The fixture has HLR-T02 with no downstream LLR — the linter
        // should report at least one coverage-gap warning.
        let hasFindings = false;
        try {
            const badge = await problemsView.getCountBadge();
            const text = await badge.getText();
            hasFindings = parseInt(text, 10) > 0;
        } catch {
            // No badge element = 0 problems
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
        const sidebar = new SideBarView();
        const section = (await sidebar
            .getContent()
            .getSection('TraceR')) as CustomTreeSection;
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        await driver.sleep(1000);
        const hlrLeaf = await section.findItem('HLR-T01 Sample HLR');
        expect(hlrLeaf).to.not.be.undefined;
        const menu = await hlrLeaf!.openContextMenu();
        const revealItem = await menu.getItem(
            'Project Spec: Reveal in Project.xml',
        );
        await revealItem!.select();
        await driver.sleep(3000);
        // Check for code lenses in the editor
        const editor = new TextEditor();
        const lenses = await editor.getCodeLenses();
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
