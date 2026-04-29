// UI integration test: form panel correctly displays trace refs when
// a test traces directly to an HLR (not through an LLR).
//
// Verifies fix for: ref select showing empty when target != primary_target.
//
// Traces: LLR-PSP-07, HLR-022

import { expect } from 'chai';
import * as path from 'path';
import {
    ActivityBar,
    By,
    CustomTreeSection,
    EditorView,
    SideBarView,
    TreeItem,
    VSBrowser,
    WebDriver,
    WebView,
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

describe('Form panel trace ref display (UI)', function () {
    this.timeout(120_000);
    let driver: WebDriver;

    before(async function () {
        driver = VSBrowser.instance.driver;
        await VSBrowser.instance.openResources(FIXTURE_WORKSPACE);
        await driver.sleep(8000);
        const activityBar = new ActivityBar();
        const viewControl = await activityBar.getViewControl('TraceR');
        if (viewControl) {
            await viewControl.openView();
        }
        await driver.sleep(3000);
    });

    afterEach(async function () {
        // Dismiss any dialog and close editors.
        try {
            const dialog = await driver.findElements({ css: '.monaco-dialog-box' });
            if (dialog.length > 0) {
                const buttons = await driver.findElements({
                    css: '.monaco-dialog-box .dialog-buttons a.monaco-button',
                });
                for (const btn of buttons) {
                    const label = await btn.getText();
                    if (label.includes("Don't Save") || label.includes('Cancel')) {
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
    });

    it('test tracing directly to HLR shows HLR-T01 in the ref select', async function () {
        const section = await getProjectSpecSection();

        // Navigate to Tests → file → test_direct_hlr_trace
        const items = await section.getVisibleItems();
        let testsGroup: TreeItem | undefined;
        for (const item of items) {
            const label = await item.getLabel();
            if (label.startsWith('Tests (')) {
                testsGroup = item;
                break;
            }
        }
        expect(testsGroup, 'Tests group not found').to.not.be.undefined;

        // Expand the tests group and file node.
        await section.openItem(
            await testsGroup!.getLabel(),
            'treeView.test.ts (2)',
        );
        await driver.sleep(1000);

        const testLeaf = await section.findItem('test_direct_hlr_trace');
        expect(testLeaf, 'test_direct_hlr_trace leaf not found').to.not.be
            .undefined;

        // Click to open form.
        await testLeaf!.select();
        await driver.sleep(3000);

        // Switch into the webview iframe.
        const webview = new WebView();
        await webview.switchToFrame();

        try {
            // The form renders traces as an array of objects. Each
            // trace row has a select for target and ref.
            const targetSelects = await webview.findWebElements(
                By.css('select[id*="target"]'),
            );
            expect(
                targetSelects.length,
                'Expected at least one target select element',
            ).to.be.greaterThan(0);

            const targetValue = await targetSelects[0].getAttribute('value');
            expect(targetValue, 'target select should show HLR').to.equal('HLR');

            const refSelects = await webview.findWebElements(
                By.css('select[id*="ref"]'),
            );
            expect(
                refSelects.length,
                'Expected at least one ref select element',
            ).to.be.greaterThan(0);

            // The first (and only) trace row should have value "HLR-T01".
            const value = await refSelects[0].getAttribute('value');
            expect(value, 'ref select should show HLR-T01, not be empty').to.equal(
                'HLR-T01',
            );
        } finally {
            await webview.switchBack();
        }
    });

    it('test tracing to LLR shows LLR-UT-01 in the ref select', async function () {
        const section = await getProjectSpecSection();

        const items = await section.getVisibleItems();
        let testsGroup: TreeItem | undefined;
        for (const item of items) {
            const label = await item.getLabel();
            if (label.startsWith('Tests (')) {
                testsGroup = item;
                break;
            }
        }
        expect(testsGroup, 'Tests group not found').to.not.be.undefined;

        await section.openItem(
            await testsGroup!.getLabel(),
            'treeView.test.ts (2)',
        );
        await driver.sleep(1000);

        const testLeaf = await section.findItem('test_tree_shows_hlr_leaf');
        expect(testLeaf, 'test_tree_shows_hlr_leaf leaf not found').to.not.be
            .undefined;

        await testLeaf!.select();
        await driver.sleep(3000);

        const webview = new WebView();
        await webview.switchToFrame();

        try {
            const targetSelects = await webview.findWebElements(
                By.css('select[id*="target"]'),
            );
            expect(
                targetSelects.length,
                'Expected at least one target select element',
            ).to.be.greaterThan(0);

            const targetValue = await targetSelects[0].getAttribute('value');
            expect(targetValue, 'target select should show LLR').to.equal('LLR');

            const refSelects = await webview.findWebElements(
                By.css('select[id*="ref"]'),
            );
            expect(
                refSelects.length,
                'Expected at least one ref select element',
            ).to.be.greaterThan(0);

            const value = await refSelects[0].getAttribute('value');
            expect(value, 'ref select should show LLR-UT-01, not be empty').to.equal(
                'LLR-UT-01',
            );
        } finally {
            await webview.switchBack();
        }
    });
});
