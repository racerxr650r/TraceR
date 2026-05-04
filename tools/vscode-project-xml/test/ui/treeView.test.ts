// UI integration tests for the Project Spec tree view.
//
// Uses vscode-extension-tester (ExTester) to drive a real VS Code
// instance with the extension installed. Verifies that:
//   * the tree view populates with HLR / LLR / Test / SDD leaves;
//   * clicking a leaf fires the editPayload command (opens the form);
//   * right-clicking a leaf shows "Edit in Form…" in the context menu;
//   * right-clicking shows "Reveal in Project.xml" in the context menu.
//
// Traces: LLR-PSP-07, HLR-022, HLR-026

import { expect } from 'chai';
import * as path from 'path';
import {
    ActivityBar,
    EditorView,
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

describe('Project Spec tree view (UI)', function () {
    this.timeout(120_000);
    this.retries(2);
    let driver: WebDriver;

    before(async function () {
        driver = VSBrowser.instance.driver;
        // Open the fixture workspace containing doc/Project.xml.
        await VSBrowser.instance.openResources(FIXTURE_WORKSPACE);
        // Dismiss the VS Code onboarding overlay that blocks clicks in CI.
        await dismissWelcomeOverlay(driver);
        // Open the Project Spec view via the Activity Bar.
        const activityBar = new ActivityBar();
        const viewControl = await activityBar.getViewControl('TraceR');
        if (viewControl) {
            await viewControl.openView();
        }
        // Wait until the tree has real groups (not just a placeholder)
        // before starting tests. Polling replaces fixed sleeps.
        const section = await getProjectSpecSection();
        await expandGroup(section, 'HLRs');
    });

    afterEach(async function () {
        // Dismiss any modal dialog (e.g. "Save changes?") before
        // attempting to close editors, otherwise the click is
        // intercepted by the dialog overlay.
        try {
            const dialog = await driver.findElements(
                { css: '.monaco-dialog-box' },
            );
            if (dialog.length > 0) {
                // Press the "Don't Save" / secondary button to dismiss.
                const buttons = await driver.findElements(
                    { css: '.monaco-dialog-box .dialog-buttons a.monaco-button' },
                );
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
            // no dialog – continue
        }
        try {
            await new EditorView().closeAllEditors();
        } catch {
            // best-effort cleanup
        }
    });

    // ── Tree population ──────────────────────────────────────────

    it('shows the HLRs group with at least one child', async function () {
        const section = await getProjectSpecSection();
        const children = await expandGroup(section, 'HLRs');
        expect(children.length).to.be.greaterThan(0);
    });

    it('shows the LLRs group with at least one child', async function () {
        const section = await getProjectSpecSection();
        const children = await expandGroup(section, 'LLRs');
        expect(children.length).to.be.greaterThan(0);
    });

    it('shows the Tests group with at least one child', async function () {
        const section = await getProjectSpecSection();
        const children = await expandGroup(section, 'Tests');
        expect(children.length).to.be.greaterThan(0);
    });

    // ── Right-click context menu ─────────────────────────────────

    it('right-click on HLR leaf shows "Reveal in Project.xml"', async function () {
        const section = await getProjectSpecSection();
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        const hlrLeaf = await waitForTreeItem(section, 'HLR-T01 Sample HLR');
        const menu = await retryOnStale(() => hlrLeaf.openContextMenu());
        const items = await menu.getItems();
        const labels = await Promise.all(items.map((i) => i.getLabel()));
        expect(labels).to.include('Project Spec: Reveal in Project.xml');
        await menu.close();
    });

    it('right-click on HLR leaf shows "Edit in Form…"', async function () {
        const section = await getProjectSpecSection();
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        const hlrLeaf = await waitForTreeItem(section, 'HLR-T01 Sample HLR');
        const menu = await retryOnStale(() => hlrLeaf.openContextMenu());
        const items = await menu.getItems();
        const labels = await Promise.all(items.map((i) => i.getLabel()));
        expect(labels).to.include('Project Spec: Edit in Form…');
        await menu.close();
    });

    // ── Click to edit ────────────────────────────────────────────

    it('clicking an HLR leaf opens the edit form panel', async function () {
        const section = await getProjectSpecSection();
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        const hlrLeaf = await waitForTreeItem(section, 'HLR-T01 Sample HLR');
        await hlrLeaf.select();
        // Poll until the form panel tab appears instead of fixed sleep.
        await waitForEditorTab(
            (t) => t.includes('Edit') || t.includes('HLR-T01') || t.includes('Form'),
        );
    });

    // ── Tree breadth ─────────────────────────────────────────────

    it('shows the SDD group with at least one child', async function () {
        const section = await getProjectSpecSection();
        const children = await expandGroup(section, 'SDD');
        expect(children.length).to.be.greaterThan(0);
    });

    it('tree root groups display accurate item counts', async function () {
        const section = await getProjectSpecSection();
        const items = await section.getVisibleItems();
        const labels: string[] = [];
        for (const item of items) {
            labels.push(await item.getLabel());
        }
        // Fixture has 2 HLRs, 1 LLR, 1 test file, 1 SDD module
        expect(labels.some((l) => l === 'HLRs (2)')).to.be.true;
        expect(labels.some((l) => l === 'LLRs (1)')).to.be.true;
        expect(labels.some((l) => l.startsWith('Tests ('))).to.be.true;
        expect(labels.some((l) => l.startsWith('SDD ('))).to.be.true;
    });

    // ── LLR context menus and click ──────────────────────────────

    it('right-click on LLR leaf shows both context commands', async function () {
        const section = await getProjectSpecSection();
        await section.openItem('LLRs (1)', 'UI Test Function (1)');
        const llrLeaf = await waitForTreeItem(section, 'LLR-UT-01');
        const menu = await retryOnStale(() => llrLeaf.openContextMenu());
        const items = await menu.getItems();
        const labels = await Promise.all(items.map((i) => i.getLabel()));
        expect(labels).to.include('Project Spec: Reveal in Project.xml');
        expect(labels).to.include('Project Spec: Edit in Form…');
        await menu.close();
    });

    it('clicking LLR leaf opens the edit form panel', async function () {
        const section = await getProjectSpecSection();
        await section.openItem('LLRs (1)', 'UI Test Function (1)');
        const llrLeaf = await waitForTreeItem(section, 'LLR-UT-01');
        await llrLeaf.select();
        await waitForEditorTab(
            (t) => t.includes('Edit') || t.includes('LLR-UT-01') || t.includes('Form'),
        );
    });

    // ── Group-node context menus ─────────────────────────────────

    it('right-click on HLRs group shows "Add High-Level Requirement…"', async function () {
        const section = await getProjectSpecSection();
        const hlrsGroup = await waitForTreeItem(section, 'HLRs (2)');
        const menu = await retryOnStale(() => hlrsGroup.openContextMenu());
        const items = await menu.getItems();
        const labels = await Promise.all(items.map((i) => i.getLabel()));
        expect(labels).to.include('Project Spec: Add High-Level Requirement…');
        await menu.close();
    });

    it('right-click on LLRs group shows "Add Low-Level Requirement…"', async function () {
        const section = await getProjectSpecSection();
        const llrsGroup = await waitForTreeItem(section, 'LLRs (1)');
        const menu = await retryOnStale(() => llrsGroup.openContextMenu());
        const items = await menu.getItems();
        const labels = await Promise.all(items.map((i) => i.getLabel()));
        expect(labels).to.include('Project Spec: Add Low-Level Requirement…');
        await menu.close();
    });

    it('right-click on Tests group shows "Add Test…"', async function () {
        const section = await getProjectSpecSection();
        await expandGroup(section, 'Tests');
        const testsNode = await waitForTreeItem(section, 'Tests (');
        const menu = await retryOnStale(() => testsNode.openContextMenu());
        const menuItems = await menu.getItems();
        const labels = await Promise.all(menuItems.map((i) => i.getLabel()));
        expect(labels).to.include('Project Spec: Add Test…');
        await menu.close();
    });

    it('right-click on SDD group shows "Add SDD Module…"', async function () {
        const section = await getProjectSpecSection();
        await expandGroup(section, 'SDD');
        const sddNode = await waitForTreeItem(section, 'SDD (');
        const menu = await retryOnStale(() => sddNode.openContextMenu());
        const menuItems = await menu.getItems();
        const labels = await Promise.all(menuItems.map((i) => i.getLabel()));
        expect(labels).to.include('Project Spec: Add SDD Module…');
        await menu.close();
    });
});
