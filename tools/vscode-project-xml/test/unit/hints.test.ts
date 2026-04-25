// Tier-1 tests for util/hints.ts (Phase 2.5b UI hint registry).
// Pins LLR-HNT-01..03: applyHintsToNode honours `icon`, optionally
// tints with `color`, and is a no-op for empty / null / unknown
// payloads. The `vscode` import resolves to the hand-rolled mock
// in test/unit/__mocks__/vscode.ts.

import * as assert from 'assert';
import * as vscode from 'vscode';
import { applyHintsToNode } from '../../src/util/hints';

function newItem(): vscode.TreeItem {
    return new vscode.TreeItem('node');
}

describe('util/hints', () => {
    describe('applyHintsToNode', () => {
        it('returns false and leaves iconPath untouched for null / undefined hints', () => {
            const a = newItem();
            assert.strictEqual(applyHintsToNode(a, null), false);
            assert.strictEqual(a.iconPath, undefined);

            const b = newItem();
            assert.strictEqual(applyHintsToNode(b, undefined), false);
            assert.strictEqual(b.iconPath, undefined);
        });

        it('returns false when no recognised key is present', () => {
            const item = newItem();
            // group alone is reserved-but-ignored today.
            assert.strictEqual(
                applyHintsToNode(item, { group: 'core' }),
                false,
            );
            assert.strictEqual(item.iconPath, undefined);
        });

        it('returns false when icon is the empty / whitespace string', () => {
            const a = newItem();
            assert.strictEqual(applyHintsToNode(a, { icon: '' }), false);
            assert.strictEqual(a.iconPath, undefined);

            const b = newItem();
            assert.strictEqual(applyHintsToNode(b, { icon: '   ' }), false);
            assert.strictEqual(b.iconPath, undefined);
        });

        it('sets a ThemeIcon when icon is provided', () => {
            const item = newItem();
            assert.strictEqual(applyHintsToNode(item, { icon: 'star' }), true);
            const icon = item.iconPath as vscode.ThemeIcon;
            assert.ok(icon instanceof vscode.ThemeIcon);
            assert.strictEqual(icon.id, 'star');
            assert.strictEqual(icon.color, undefined);
        });

        it('tints the ThemeIcon with a ThemeColor when color is provided', () => {
            const item = newItem();
            assert.strictEqual(
                applyHintsToNode(item, {
                    icon: 'warning',
                    color: 'charts.yellow',
                }),
                true,
            );
            const icon = item.iconPath as vscode.ThemeIcon;
            assert.ok(icon instanceof vscode.ThemeIcon);
            assert.strictEqual(icon.id, 'warning');
            assert.ok(icon.color instanceof vscode.ThemeColor);
            assert.strictEqual(
                (icon.color as vscode.ThemeColor).id,
                'charts.yellow',
            );
        });

        it('trims surrounding whitespace from icon and color', () => {
            const item = newItem();
            applyHintsToNode(item, {
                icon: '  flame  ',
                color: '  charts.red  ',
            });
            const icon = item.iconPath as vscode.ThemeIcon;
            assert.strictEqual(icon.id, 'flame');
            assert.strictEqual(
                (icon.color as vscode.ThemeColor).id,
                'charts.red',
            );
        });

        it('treats whitespace-only color as absent (icon only, no tint)', () => {
            const item = newItem();
            applyHintsToNode(item, { icon: 'star', color: '   ' });
            const icon = item.iconPath as vscode.ThemeIcon;
            assert.strictEqual(icon.id, 'star');
            assert.strictEqual(icon.color, undefined);
        });

        it('ignores `group` while still honouring icon when both are set', () => {
            const item = newItem();
            applyHintsToNode(item, { icon: 'rocket', group: 'core' });
            const icon = item.iconPath as vscode.ThemeIcon;
            assert.strictEqual(icon.id, 'rocket');
        });

        it('replaces a pre-existing iconPath when hints fire', () => {
            const item = newItem();
            item.iconPath = new vscode.ThemeIcon('symbol-namespace');
            applyHintsToNode(item, { icon: 'star' });
            const icon = item.iconPath as vscode.ThemeIcon;
            assert.strictEqual(icon.id, 'star');
        });

        it('preserves a pre-existing iconPath when hints do not fire', () => {
            const item = newItem();
            const original = new vscode.ThemeIcon('symbol-namespace');
            item.iconPath = original;
            applyHintsToNode(item, null);
            assert.strictEqual(item.iconPath, original);
        });
    });
});
