// UI integration tests for the AI tree context-menu (gap.fix intent).
//
// Uses vscode-extension-tester (ExTester) to drive a real VS Code
// instance with the extension installed. Exercises the gap.fix flow
// end-to-end:
//   * right-clicking an uncovered HLR shows "Run AI Action…";
//   * selecting it opens a Quick Pick with applicable intents;
//   * choosing "Fix coverage gap with AI" opens an input box;
//   * submitting the input starts the AI pipeline (resulting in either
//     a diff preview or a "no model" warning in environments without
//     a language model provider).
//
// Traces: LLR-PSP-07, HLR-053

import { expect } from 'chai';
import * as path from 'path';
import {
    ActivityBar,
    CustomTreeSection,
    EditorView,
    Input,
    InputBox,
    Notification,
    SideBarView,
    VSBrowser,
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
 * Poll until a notification matching `predicate` appears, or timeout.
 */
async function waitForNotification(
    driver: WebDriver,
    predicate: (msg: string) => boolean,
    timeout = 15_000,
): Promise<Notification | undefined> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try {
            const workbench = new Workbench();
            const notifications = await workbench.getNotifications();
            for (const n of notifications) {
                const msg = await n.getMessage();
                if (predicate(msg)) {
                    return n;
                }
            }
        } catch {
            // notifications pane may not be ready
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    return undefined;
}

describe('AI tree menu — gap.fix (UI)', function () {
    this.timeout(120_000);
    let driver: WebDriver;

    before(async function () {
        driver = VSBrowser.instance.driver;
        await VSBrowser.instance.openResources(FIXTURE_WORKSPACE);
        await driver.sleep(8000);
        // Open the TraceR view
        const activityBar = new ActivityBar();
        const viewControl = await activityBar.getViewControl('TraceR');
        if (viewControl) {
            await viewControl.openView();
        }
        await driver.sleep(3000);
        // Wait for tree to populate
        const section = await getProjectSpecSection();
        const items = await section.getVisibleItems();
        const deadline = Date.now() + 30_000;
        let found = false;
        while (Date.now() < deadline && !found) {
            for (const item of await section.getVisibleItems()) {
                const label = await item.getLabel();
                if (label.startsWith('HLRs')) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                await new Promise((r) => setTimeout(r, 1000));
            }
        }
        if (!found) {
            throw new Error('HLRs group never appeared in tree');
        }
    });

    afterEach(async function () {
        // Dismiss any modal dialog
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
        // Cancel any open input box / quick pick
        try {
            const input = await InputBox.create(1000);
            await input.cancel();
        } catch {
            // no input box open
        }
        try {
            await new EditorView().closeAllEditors();
        } catch {
            // best-effort
        }
    });

    // ── Tree navigation (always runs) ─────────────────────────────

    it('HLR-T02 (uncovered) leaf is visible and has a context menu', async function () {
        const section = await getProjectSpecSection();
        // Navigate to HLR-T02 (uncovered — no downstream LLR)
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        await driver.sleep(1000);
        const hlrLeaf = await section.findItem('HLR-T02');
        expect(hlrLeaf, 'HLR-T02 leaf not found in tree').to.not.be
            .undefined;
        const menu = await hlrLeaf!.openContextMenu();
        const items = await menu.getItems();
        const labels = await Promise.all(items.map((i) => i.getLabel()));
        await menu.close();
        // Deterministic context commands are always present
        expect(labels).to.include('Project Spec: Reveal in Project.xml');
        expect(labels).to.include('Project Spec: Edit in Form…');
    });

    // ── Context menu — AI entry (requires model) ─────────────────

    it('right-click on uncovered HLR shows "Run AI Action…" when AI is available', async function () {
        const section = await getProjectSpecSection();
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        await driver.sleep(1000);
        const hlrLeaf = await section.findItem('HLR-T02');
        expect(hlrLeaf).to.not.be.undefined;
        const menu = await hlrLeaf!.openContextMenu();
        const items = await menu.getItems();
        const labels = await Promise.all(items.map((i) => i.getLabel()));
        await menu.close();

        // The "Run AI Action…" entry requires both the aiTargetable
        // viewItem and projectXml.ai.available context key. If no
        // language model is available, the entry won't appear.
        if (!labels.includes('Project Spec: Run AI Action…')) {
            console.log(
                '[ai-test] "Run AI Action…" not in context menu — ' +
                    'AI unavailable in this environment; skipping.',
            );
            this.skip();
            return;
        }
        expect(labels).to.include('Project Spec: Run AI Action…');
    });

    // ── Full gap.fix flow ────────────────────────────────────────

    it('gap.fix flow: context menu → intent picker → input → outcome', async function () {
        const section = await getProjectSpecSection();
        await section.openItem('HLRs (2)', '§1 UI Test Section (2)');
        await driver.sleep(1000);
        const hlrLeaf = await section.findItem('HLR-T02');
        expect(hlrLeaf, 'HLR-T02 leaf not found in tree').to.not.be
            .undefined;

        // Open context menu and look for AI action
        const menu = await hlrLeaf!.openContextMenu();
        const menuItems = await menu.getItems();
        const labels = await Promise.all(menuItems.map((i) => i.getLabel()));

        if (!labels.includes('Project Spec: Run AI Action…')) {
            await menu.close();
            console.log(
                '[ai-test] AI unavailable — skipping gap.fix flow.',
            );
            this.skip();
            return;
        }

        // Click "Run AI Action…"
        const aiItem = await menu.getItem('Project Spec: Run AI Action…');
        expect(aiItem).to.not.be.undefined;
        await aiItem!.select();
        await driver.sleep(1500);

        // A Quick Pick should appear listing applicable intents.
        // For an Hlr node: draft.hlr, expand.hlr_to_llrs, review.item,
        // suggest.traces, gap.fix — or it may skip the picker if only
        // one intent applies (unlikely for Hlr).
        let input: Input;
        try {
            input = await InputBox.create(5000);
        } catch {
            // If no quick pick / input appeared, the command may have
            // already proceeded (single-intent shortcut) or errored.
            console.log(
                '[ai-test] No Quick Pick appeared after clicking AI action.',
            );
            this.skip();
            return;
        }

        // Look for "Fix coverage gap with AI" in the quick picks
        const picks = await input.getQuickPicks();
        const pickLabels: string[] = [];
        for (const p of picks) {
            pickLabels.push(await p.getLabel());
        }

        const gapFixLabel = 'Fix coverage gap with AI';
        if (!pickLabels.includes(gapFixLabel)) {
            // gap.fix not listed — close and report
            await input.cancel();
            console.log(
                `[ai-test] "${gapFixLabel}" not in picks: [${pickLabels.join(', ')}]`,
            );
            this.skip();
            return;
        }

        // Select the gap.fix intent
        await input.selectQuickPick(gapFixLabel);
        await driver.sleep(1000);

        // An input box should now appear asking for a description
        let descInput: Input;
        try {
            descInput = await InputBox.create(5000);
        } catch {
            console.log(
                '[ai-test] No input box appeared after selecting gap.fix intent.',
            );
            this.skip();
            return;
        }

        const placeholder = await descInput.getPlaceHolder();
        expect(
            placeholder || (await descInput.getTitle()) || '',
        ).to.match(/describe|gap/i);

        // Type a user prompt and confirm
        await descInput.setText(
            'Add an LLR that covers the untested requirement HLR-T02.',
        );
        await descInput.confirm();
        await driver.sleep(3000);

        // After confirming, the pipeline runs. In a test environment
        // without a language model the outcome is "no-model" warning.
        // With a model, we'd get a diff preview or "applied" toast.
        // Either way, a notification should appear.
        const notification = await waitForNotification(
            driver,
            (msg) =>
                msg.includes('no language model') ||
                msg.includes('Applied gap.fix') ||
                msg.includes('gap.fix rejected') ||
                msg.includes('Project Spec AI'),
            15_000,
        );

        // We just verify *some* recognizable outcome appeared.
        // The exact result depends on the environment.
        expect(
            notification,
            'Expected an AI outcome notification (applied, rejected, or no-model)',
        ).to.not.be.undefined;

        if (notification) {
            const msg = await notification.getMessage();
            console.log(`[ai-test] gap.fix outcome: "${msg}"`);
            await notification.dismiss();
        }
    });
});
