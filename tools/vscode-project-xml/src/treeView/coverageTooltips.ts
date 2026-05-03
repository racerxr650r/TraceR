// Tree-view tooltip enrichment — thin wrapper around
// coverageTooltipLogic.ts (humble object pattern, Phase 10).

import * as vscode from 'vscode';
import { ParsedProject } from '../sidecar';
import { ProjectSpecNode } from './ProjectSpecProvider';
import {
    buildCoverageIndex as _buildCoverageIndex,
    tooltipMarkdownForHlr,
    tooltipMarkdownForLlr,
    tooltipMarkdownForTest,
} from './coverageTooltipLogic';

// Re-export for backward compat (FormPanelProvider imports these).
export type { CoverageIndex } from './coverageTooltipLogic';
export { buildCoverageIndex } from './coverageTooltipLogic';

export function decorateTooltips(
    roots: ProjectSpecNode[],
    project: ParsedProject,
): void {
    const index = _buildCoverageIndex(project);
    const stack: ProjectSpecNode[] = [...roots];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.locator) {
            const raw = buildTooltipRaw(node.locator.tag, node.locator.value, index);
            if (raw) {
                const md = new vscode.MarkdownString(raw, true);
                md.isTrusted = true;
                md.supportHtml = false;
                node.tooltip = md;
            }
        }
        if (node.children) { stack.push(...node.children); }
    }
}

function buildTooltipRaw(
    tag: string,
    value: string,
    index: import('./coverageTooltipLogic').CoverageIndex,
): string | undefined {
    switch (tag) {
        case 'hlr': return tooltipMarkdownForHlr(value, index);
        case 'llr': return tooltipMarkdownForLlr(value, index);
        case 'test': return tooltipMarkdownForTest(value, index);
        default: return undefined;
    }
}

/**
 * Exported for tier-1 tests. Returns a MarkdownString wrapper.
 */
export function buildTooltip(
    locator: import('./treeLogic').RevealLocator,
    index: import('./coverageTooltipLogic').CoverageIndex,
): vscode.MarkdownString | undefined {
    const raw = buildTooltipRaw(locator.tag, locator.value, index);
    if (!raw) { return undefined; }
    const md = new vscode.MarkdownString(raw, true);
    md.isTrusted = true;
    md.supportHtml = false;
    return md;
}
