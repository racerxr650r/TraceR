// Phase 2.5b UI hint registry consumer.
//
// The Python renderer surfaces optional `ui:icon` / `ui:color` /
// `ui:group` attributes (urn:tracer:ui:v1) on every parsed payload
// node under a `.ui` field. This module isolates the logic that
// turns those flat hint dicts into VS Code TreeItem decoration so
// the tree provider stays declarative.
//
// `applyHintsToNode(node, hints)` mutates the node's `iconPath` when
// a recognised codicon name is present, optionally tinting it with a
// `ThemeColor` when `color` is also set. Unknown / empty hints are
// no-ops, so the same code path runs whether or not the underlying
// element carried any ui:* attributes.

import * as vscode from 'vscode';
import { UiHints } from '../sidecar';

/**
 * Apply UI hints to a tree node in-place. Returns `true` when the
 * hints contributed any decoration (used by tests to assert the
 * registry actually fired), `false` when the hints were empty / null
 * / undefined or contained no recognised keys.
 *
 * Only `icon` and `color` are honoured today; `group` is reserved
 * for a future grouping pass and is intentionally accepted-and-
 * ignored here so payloads can carry it without warnings.
 */
export function applyHintsToNode(
    node: vscode.TreeItem,
    hints: UiHints | null | undefined,
): boolean {
    if (!hints) {
        return false;
    }
    const icon = typeof hints.icon === 'string' ? hints.icon.trim() : '';
    if (!icon) {
        return false;
    }
    const color =
        typeof hints.color === 'string' && hints.color.trim().length > 0
            ? new vscode.ThemeColor(hints.color.trim())
            : undefined;
    node.iconPath = new vscode.ThemeIcon(icon, color);
    return true;
}
