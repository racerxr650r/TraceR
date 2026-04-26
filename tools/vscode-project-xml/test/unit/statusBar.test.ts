// Phase 6 (LLR-PKG-08, HLR-042): pin the LintStatusBar rendering
// rules — the displayed icon, text, and tooltip MUST mirror the
// underlying lint counts verbatim while honouring
// `projectXml.warningsAsErrors` only as a visual-escalation knob.

import * as assert from 'assert';
import { __test as vscodeTest, FakeStatusBarItem, MarkdownString } from './__mocks__/vscode';
import { LintStatusBar } from '../../src/statusBar';
import type { LintResult } from '../../src/sidecar';

function makeResult(errors = 0, warnings = 0, notes = 0): LintResult {
    return {
        errors: Array.from({ length: errors }, (_, i) => `err${i}`),
        warnings: Array.from({ length: warnings }, (_, i) => `warn${i}`),
        notes: Array.from({ length: notes }, (_, i) => `note${i}`),
        items: [],
        ok: errors === 0,
    };
}

function getItem(): FakeStatusBarItem {
    const items = vscodeTest.statusBarItems();
    assert.ok(items.length >= 1, 'expected at least one status-bar item');
    return items[items.length - 1];
}

function tooltipText(item: FakeStatusBarItem): string {
    const t = item.tooltip;
    if (t instanceof MarkdownString) {
        return t.value;
    }
    return typeof t === 'string' ? t : '';
}

describe('statusBar — LintStatusBar (LLR-PKG-08, HLR-042)', () => {
    afterEach(() => vscodeTest.reset());

    it('renders 0/0 with the check icon when no result has been pushed yet', () => {
        const bar = new LintStatusBar();
        try {
            const item = getItem();
            assert.match(item.text, /\$\(check\)/);
            assert.match(item.text, /0 errors \/ 0 warnings/);
            assert.strictEqual(item.backgroundColor, undefined);
            assert.strictEqual(item.command, 'projectXml.showProblems');
        } finally {
            bar.dispose();
        }
    });

    it('escalates the badge to error when any error is present', () => {
        const bar = new LintStatusBar();
        try {
            bar.update(makeResult(2, 1, 0));
            const item = getItem();
            assert.match(item.text, /\$\(error\)/);
            assert.match(item.text, /2 errors \/ 1 warning/);
            // Background color should be the error themed color.
            assert.ok(item.backgroundColor, 'expected an error background color');
        } finally {
            bar.dispose();
        }
    });

    it('shows the warning badge when warnings exist and no errors', () => {
        const bar = new LintStatusBar();
        try {
            bar.update(makeResult(0, 1, 0));
            const item = getItem();
            assert.match(item.text, /\$\(warning\)/);
            assert.match(item.text, /0 errors \/ 1 warning/);
            assert.ok(item.backgroundColor);
        } finally {
            bar.dispose();
        }
    });

    it('clears state when update is called with undefined', () => {
        const bar = new LintStatusBar();
        try {
            bar.update(makeResult(1, 0, 0));
            bar.update(undefined);
            const item = getItem();
            assert.match(item.text, /\$\(check\)/);
            assert.match(item.text, /0 errors \/ 0 warnings/);
        } finally {
            bar.dispose();
        }
    });

    it('escalates warnings into the displayed error count when warningsAsErrors=true, but tooltip still shows raw counts (HLR-042)', () => {
        vscodeTest.setConfig({ warningsAsErrors: true });
        const bar = new LintStatusBar();
        try {
            bar.update(makeResult(1, 2, 1));
            const item = getItem();
            // Displayed total: 1 error + 2 warnings = 3 errors / 0 warnings.
            assert.match(item.text, /\$\(error\)/);
            assert.match(item.text, /3 errors \/ 0 warnings/);

            // Tooltip MUST show raw counts verbatim — that's the HLR-042
            // contract: warnings are NEVER suppressed, only re-classified
            // for display severity.
            const tip = tooltipText(item);
            assert.ok(/Errors: 1/.test(tip), `tooltip should show raw Errors: 1, got:\n${tip}`);
            assert.ok(/Warnings: 2/.test(tip), `tooltip should show raw Warnings: 2, got:\n${tip}`);
            assert.ok(/Notes: 1/.test(tip));
            assert.ok(/warningsAsErrors/.test(tip), 'tooltip should mention the escalation policy');
        } finally {
            bar.dispose();
        }
    });

    it('re-renders when projectXml.warningsAsErrors changes', () => {
        const bar = new LintStatusBar();
        try {
            bar.update(makeResult(0, 1, 0));
            const item = getItem();
            assert.match(item.text, /\$\(warning\)/);

            // Flip the policy and fire the config-change event.
            vscodeTest.setConfig({ warningsAsErrors: true });
            vscodeTest.fireConfigChange(['projectXml.warningsAsErrors']);

            assert.match(item.text, /\$\(error\)/);
            assert.match(item.text, /1 error \/ 0 warnings/);
        } finally {
            bar.dispose();
        }
    });
});
