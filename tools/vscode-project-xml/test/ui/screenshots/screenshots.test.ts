// Screenshot capture suite for TraceR documentation.
//
// Runs as part of the ExTester UI test suite and saves annotated
// screenshots to images/screenshots/ at the repository root.
// These images are intended for inclusion in the User Manual,
// Developer's Guide, and README.
//
// The suite is ordered to build on previous state: tree view first,
// then context menus, edit forms, editor features, and finally
// the status bar / problems panel.

import * as fs from 'fs';
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
    ViewItem,
    WebDriver,
} from 'vscode-extension-tester';

const FIXTURE_WORKSPACE = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'test',
    'ui',
    'fixtures',
);

// Screenshots land at <repo-root>/images/screenshots/
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const SCREENSHOT_DIR = path.join(REPO_ROOT, 'images', 'screenshots');

/** Save a full-window screenshot as `<name>.png`. */
async function capture(driver: WebDriver, name: string): Promise<void> {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const base64 = await driver.takeScreenshot();
    const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
    fs.writeFileSync(filePath, base64, 'base64');
}

/** Get the TraceR tree section, retrying until the sidecar is ready. */
async function getSection(timeout = 30_000): Promise<CustomTreeSection> {
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
    throw new Error(`TraceR section not found within ${timeout}ms: ${lastErr}`);
}

describe('Screenshot capture for documentation', function () {
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
        // Dismiss any modal dialog before closing editors.
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
        try {
            const bottomBar = new BottomBarPanel();
            await bottomBar.toggle(false);
        } catch {
            // not open
        }
    });

    // ── Tree view ────────────────────────────────────────────────

    it('tree-view-collapsed: all groups collapsed with counts', async function () {
        const section = await getSection();
        // Collapse everything first by getting visible items
        const items = await section.getVisibleItems();
        for (const item of items) {
            try {
                if (await item.isExpanded()) {
                    await item.select();
                    await driver.sleep(300);
                }
            } catch {
                // not expandable
            }
        }
        await driver.sleep(500);
        await capture(driver, 'tree-view-collapsed');
    });

    it('tree-view-expanded: HLRs group expanded showing leaves', async function () {
        const section = await getSection();
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        await driver.sleep(1000);
        await capture(driver, 'tree-view-expanded');
    });

    // ── Context menus ────────────────────────────────────────────

    it('context-menu-leaf: right-click on HLR leaf', async function () {
        const section = await getSection();
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        await driver.sleep(1000);
        const leaf = await section.findItem('HLR-T01 Sample HLR');
        const menu = await leaf!.openContextMenu();
        await driver.sleep(500);
        await capture(driver, 'context-menu-leaf');
        await menu.close();
    });

    it('context-menu-group: right-click on HLRs group', async function () {
        const section = await getSection();
        const group = await section.findItem('HLRs (2)');
        const menu = await group!.openContextMenu();
        await driver.sleep(500);
        await capture(driver, 'context-menu-group');
        await menu.close();
    });

    // ── Edit form panel ──────────────────────────────────────────

    it('edit-form: HLR edit form with coverage hints', async function () {
        const section = await getSection();
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        await driver.sleep(1000);
        const leaf = await section.findItem('HLR-T01 Sample HLR');
        await leaf!.select();
        await driver.sleep(3000);
        await capture(driver, 'edit-form');
    });

    // ── Reveal in XML ────────────────────────────────────────────

    it('reveal-in-xml: Project.xml with HLR element selected', async function () {
        const section = await getSection();
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        await driver.sleep(1000);
        const leaf = await section.findItem('HLR-T01 Sample HLR');
        const menu = await leaf!.openContextMenu();
        const item = await menu.getItem('Project Spec: Reveal in Project.xml');
        await item!.select();
        await driver.sleep(2000);
        await capture(driver, 'reveal-in-xml');
    });

    // ── Code lenses ──────────────────────────────────────────────

    it('code-lenses: coverage lenses on HLR elements', async function () {
        const sidebar = new SideBarView();
        const section = (await sidebar
            .getContent()
            .getSection('TraceR')) as CustomTreeSection;
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        await driver.sleep(1000);
        const leaf = await section.findItem('HLR-T01 Sample HLR');
        const menu = await leaf!.openContextMenu();
        const item = await menu.getItem('Project Spec: Reveal in Project.xml');
        await item!.select();
        await driver.sleep(3000);
        await capture(driver, 'code-lenses');
    });

    // ── Status bar ───────────────────────────────────────────────

    it('status-bar: lint summary in status bar', async function () {
        // Just need the status bar visible — it's always there.
        await driver.sleep(500);
        await capture(driver, 'status-bar');
    });

    // ── Problems panel ───────────────────────────────────────────

    it('problems-panel: lint diagnostics', async function () {
        const bottomBar = new BottomBarPanel();
        await bottomBar.toggle(true);
        await bottomBar.openProblemsView();
        await driver.sleep(2000);
        await capture(driver, 'problems-panel');
    });
});
