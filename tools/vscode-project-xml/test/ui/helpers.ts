/**
 * Shared helpers for ExTester UI tests.
 *
 * Provides utilities to dismiss VS Code's onboarding overlay and other
 * modal dialogs that block interactions with the main UI in headless CI,
 * plus polling helpers that replace brittle `driver.sleep()` waits.
 */
import {
    CustomTreeSection,
    EditorView,
    Key,
    Notification,
    SideBarView,
    VSBrowser,
    ViewItem,
    WebDriver,
    Workbench,
} from 'vscode-extension-tester';

/* ── Constants ────────────────────────────────────────────────── */

/** Default poll interval (ms) between retries. */
const POLL_MS = 500;

/* ── Welcome overlay ──────────────────────────────────────────── */

/**
 * Dismiss the VS Code onboarding/walkthrough overlay if it is present.
 * This overlay (class `onboarding-a-overlay`) is shown on first launch
 * of a fresh VS Code profile and intercepts all clicks to the activity bar.
 *
 * Strategy: press Escape (closes most overlays), then if the element is
 * still in the DOM, remove it via JS execution.
 */
export async function dismissWelcomeOverlay(driver?: WebDriver): Promise<void> {
    const d = driver ?? VSBrowser.instance.driver;
    // Press Escape to try to close the overlay naturally.
    const body = await d.findElement({ css: 'body' });
    await body.sendKeys(Key.ESCAPE);
    await d.sleep(500);
    // If the overlay is still there, forcibly remove it from the DOM.
    await d.executeScript(`
        const overlay = document.querySelector('.onboarding-a-overlay');
        if (overlay) overlay.remove();
    `);
    await d.sleep(300);
}

/* ── Tree section helpers ─────────────────────────────────────── */

/**
 * Wait for the "TraceR" tree section to appear in the sidebar.
 * Polls until the section is found or `timeout` expires.
 */
export async function getProjectSpecSection(
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
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
    throw new Error(
        `TraceR section not found within ${timeout}ms: ${lastErr}`,
    );
}

/**
 * Expand a top-level tree group (e.g. "HLRs (2)") by matching the
 * prefix, then return its child items.  Polls until the group appears
 * or `timeout` expires — the sidecar may still be parsing when the
 * first call arrives.
 */
export async function expandGroup(
    section: CustomTreeSection,
    prefix: string,
    timeout = 30_000,
): Promise<ViewItem[]> {
    const deadline = Date.now() + timeout;
    let lastLabels: string[] = [];
    while (Date.now() < deadline) {
        const items = await section.getVisibleItems();
        lastLabels = [];
        for (const item of items) {
            const label = await item.getLabel();
            lastLabels.push(label);
            if (label.startsWith(prefix)) {
                if (await item.isExpandable()) {
                    await item.select();
                    // Poll until children appear instead of fixed sleep
                    const childDeadline = Date.now() + 5_000;
                    while (Date.now() < childDeadline) {
                        const visible = await section.getVisibleItems();
                        if (visible.length > items.length) {
                            return visible;
                        }
                        await new Promise((r) => setTimeout(r, POLL_MS));
                    }
                }
                return section.getVisibleItems();
            }
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
    throw new Error(
        `No tree group starting with "${prefix}" found (waited ${timeout}ms). ` +
            `Visible items: [${lastLabels.join(', ')}]`,
    );
}

/* ── Tree item helpers ────────────────────────────────────────── */

/**
 * Poll `section.findItem()` until the item appears or `timeout`
 * expires. Returns the item, or throws.  Replaces the pattern of
 * `driver.sleep(N); section.findItem(label)` which is timing-fragile.
 */
export async function waitForTreeItem(
    section: CustomTreeSection,
    label: string,
    timeout = 15_000,
): Promise<ViewItem> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try {
            const item = await section.findItem(label);
            if (item) {
                return item;
            }
        } catch {
            // item not yet rendered
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
    throw new Error(
        `Tree item "${label}" not found within ${timeout}ms`,
    );
}

/* ── Editor helpers ───────────────────────────────────────────── */

/**
 * Poll `EditorView.getOpenEditorTitles()` until a title matching
 * `predicate` appears, or `timeout` expires.  Returns the matching
 * title string.
 */
export async function waitForEditorTab(
    predicate: (title: string) => boolean,
    timeout = 15_000,
): Promise<string> {
    const deadline = Date.now() + timeout;
    let lastTitles: string[] = [];
    while (Date.now() < deadline) {
        try {
            const editorView = new EditorView();
            const titles = await editorView.getOpenEditorTitles();
            lastTitles = titles;
            const match = titles.find(predicate);
            if (match) {
                return match;
            }
        } catch {
            // editor view may not be ready
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
    throw new Error(
        `No editor tab matching predicate found within ${timeout}ms. ` +
            `Open tabs: [${lastTitles.join(', ')}]`,
    );
}

/**
 * Retry an async action up to `maxRetries` times, swallowing
 * `StaleElementReferenceError` between attempts.  Useful for
 * Selenium interactions that race with DOM updates.
 */
export async function retryOnStale<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (e: unknown) {
            lastErr = e;
            const msg = e instanceof Error ? e.message : String(e);
            if (!msg.includes('StaleElementReference') && !msg.includes('stale element')) {
                throw e;
            }
            await new Promise((r) => setTimeout(r, POLL_MS));
        }
    }
    throw lastErr;
}

/* ── Notification helpers ─────────────────────────────────────── */

/**
 * Poll until a notification matching `predicate` appears, or timeout.
 * Returns the notification if found, or `undefined` if timeout expires.
 */
export async function waitForNotification(
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
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return undefined;
}
