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
    CustomTreeSection,
    EditorView,
    SideBarView,
    VSBrowser,
    ViewItem,
    WebDriver,
    Workbench,
} from 'vscode-extension-tester';

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
 * Wait for the Project Spec tree section to appear and return it.
 * Retries up to `timeout` ms because the sidecar may take a moment
 * to parse.
 */
async function getProjectSpecSection(
    timeout = 30_000,
): Promise<CustomTreeSection> {
    const sidebar = new SideBarView();
    const deadline = Date.now() + timeout;
    let lastErr: unknown;
    while (Date.now() < deadline) {
        try {
            const section = (await sidebar
                .getContent()
                .getSection('TraceR')) as CustomTreeSection;
            if (section) {
                return section;
            }
        } catch (e) {
            lastErr = e;
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(
        `TraceR section not found within ${timeout}ms: ${lastErr}`,
    );
}

/**
 * Expand a top-level tree group (e.g. "HLRs (1)") by matching the
 * prefix, then return its child items.
 */
async function expandGroup(
    section: CustomTreeSection,
    prefix: string,
): Promise<ViewItem[]> {
    // Top-level items include the count, e.g. "HLRs (1)"
    const items = await section.getVisibleItems();
    for (const item of items) {
        const label = await item.getLabel();
        if (label.startsWith(prefix)) {
            if (await item.isExpandable()) {
                await item.select();
                // Wait for the tree to expand
                await new Promise((r) => setTimeout(r, 1000));
            }
            return section.getVisibleItems();
        }
    }
    throw new Error(`No tree group starting with "${prefix}" found`);
}

describe('Project Spec tree view (UI)', function () {
    this.timeout(120_000);
    let driver: WebDriver;

    before(async function () {
        driver = VSBrowser.instance.driver;
        // Open the fixture workspace containing doc/Project.xml.
        await VSBrowser.instance.openResources(FIXTURE_WORKSPACE);
        // Allow time for the extension to activate and the sidecar to
        // parse the fixture Project.xml.
        await driver.sleep(8000);
        // Open the Project Spec view via the Activity Bar. The view is
        // contributed under the view container 'projectXml'.
        const activityBar = new ActivityBar();
        const viewControl = await activityBar.getViewControl('TraceR');
        if (viewControl) {
            await viewControl.openView();
        }
        await driver.sleep(3000);
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
        // Navigate into HLRs → section → leaf
        // Tree labels include the §N prefix, e.g. "§1 UI Test Section (2)"
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        await driver.sleep(1000);
        const hlrLeaf = await section.findItem('HLR-T01 Sample HLR');
        expect(hlrLeaf).to.not.be.undefined;
        const menu = await hlrLeaf!.openContextMenu();
        const items = await menu.getItems();
        const labels = await Promise.all(items.map((i) => i.getLabel()));
        expect(labels).to.include('Project Spec: Reveal in Project.xml');
        await menu.close();
    });

    it('right-click on HLR leaf shows "Edit in Form…"', async function () {
        const section = await getProjectSpecSection();
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        await driver.sleep(1000);
        const hlrLeaf = await section.findItem('HLR-T01 Sample HLR');
        expect(hlrLeaf).to.not.be.undefined;
        const menu = await hlrLeaf!.openContextMenu();
        const items = await menu.getItems();
        const labels = await Promise.all(items.map((i) => i.getLabel()));
        expect(labels).to.include('Project Spec: Edit in Form…');
        await menu.close();
    });

    // ── Click to edit ────────────────────────────────────────────

    it('clicking an HLR leaf opens the edit form panel', async function () {
        const section = await getProjectSpecSection();
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        await driver.sleep(1000);
        const hlrLeaf = await section.findItem('HLR-T01 Sample HLR');
        expect(hlrLeaf).to.not.be.undefined;
        // Clicking a leaf with TreeItem.command should open the form
        // webview panel.
        await hlrLeaf!.select();
        await driver.sleep(2000);
        // The form panel opens as a webview editor tab. Verify an
        // editor tab appeared (the title will contain "Edit HLR-T01"
        // or similar).
        const editorView = new EditorView();
        const titles = await editorView.getOpenEditorTitles();
        const hasEditTab = titles.some(
            (t) =>
                t.includes('Edit') ||
                t.includes('HLR-T01') ||
                t.includes('Form'),
        );
        expect(hasEditTab, `Expected an edit panel tab, got: ${titles}`).to.be
            .true;
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
        await driver.sleep(1000);
        const llrLeaf = await section.findItem('LLR-UT-01');
        expect(llrLeaf).to.not.be.undefined;
        const menu = await llrLeaf!.openContextMenu();
        const items = await menu.getItems();
        const labels = await Promise.all(items.map((i) => i.getLabel()));
        expect(labels).to.include('Project Spec: Reveal in Project.xml');
        expect(labels).to.include('Project Spec: Edit in Form…');
        await menu.close();
    });

    it('clicking LLR leaf opens the edit form panel', async function () {
        const section = await getProjectSpecSection();
        await section.openItem('LLRs (1)', 'UI Test Function (1)');
        await driver.sleep(1000);
        const llrLeaf = await section.findItem('LLR-UT-01');
        expect(llrLeaf).to.not.be.undefined;
        await llrLeaf!.select();
        await driver.sleep(2000);
        const editorView = new EditorView();
        const titles = await editorView.getOpenEditorTitles();
        const hasEditTab = titles.some(
            (t) =>
                t.includes('Edit') ||
                t.includes('LLR-UT-01') ||
                t.includes('Form'),
        );
        expect(hasEditTab, `Expected an edit panel tab, got: ${titles}`).to.be
            .true;
    });

    // ── Group-node context menus ─────────────────────────────────

    it('right-click on HLRs group shows "Add High-Level Requirement…"', async function () {
        const section = await getProjectSpecSection();
        const hlrsGroup = await section.findItem('HLRs (2)');
        expect(hlrsGroup, 'HLRs group not found').to.not.be.undefined;
        const menu = await hlrsGroup!.openContextMenu();
        const items = await menu.getItems();
        const labels = await Promise.all(items.map((i) => i.getLabel()));
        expect(labels).to.include('Project Spec: Add High-Level Requirement…');
        await menu.close();
    });

    it('right-click on LLRs group shows "Add Low-Level Requirement…"', async function () {
        const section = await getProjectSpecSection();
        const llrsGroup = await section.findItem('LLRs (1)');
        expect(llrsGroup, 'LLRs group not found').to.not.be.undefined;
        const menu = await llrsGroup!.openContextMenu();
        const items = await menu.getItems();
        const labels = await Promise.all(items.map((i) => i.getLabel()));
        expect(labels).to.include('Project Spec: Add Low-Level Requirement…');
        await menu.close();
    });

    it('right-click on Tests group shows "Add Test…"', async function () {
        const section = await getProjectSpecSection();
        const items = await section.getVisibleItems();
        let testsGroup: ViewItem | undefined;
        for (const item of items) {
            const label = await item.getLabel();
            if (label.startsWith('Tests (')) {
                testsGroup = item;
                break;
            }
        }
        expect(testsGroup, 'Tests group not found').to.not.be.undefined;
        const menu = await testsGroup!.openContextMenu();
        const menuItems = await menu.getItems();
        const labels = await Promise.all(menuItems.map((i) => i.getLabel()));
        expect(labels).to.include('Project Spec: Add Test…');
        await menu.close();
    });

    it('right-click on SDD group shows "Add SDD Module…"', async function () {
        const section = await getProjectSpecSection();
        const items = await section.getVisibleItems();
        let sddGroup: ViewItem | undefined;
        for (const item of items) {
            const label = await item.getLabel();
            if (label.startsWith('SDD (')) {
                sddGroup = item;
                break;
            }
        }
        expect(sddGroup, 'SDD group not found').to.not.be.undefined;
        const menu = await sddGroup!.openContextMenu();
        const menuItems = await menu.getItems();
        const labels = await Promise.all(menuItems.map((i) => i.getLabel()));
        expect(labels).to.include('Project Spec: Add SDD Module…');
        await menu.close();
    });
});
