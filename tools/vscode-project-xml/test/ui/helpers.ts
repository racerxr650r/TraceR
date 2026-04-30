/**
 * Shared helpers for ExTester UI tests.
 *
 * Provides utilities to dismiss VS Code's onboarding overlay and other
 * modal dialogs that block interactions with the main UI in headless CI.
 */
import { Key, VSBrowser, WebDriver } from 'vscode-extension-tester';

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
