// Pure functions for AI diff-preview content generation.
// Extracted from diffPreview.ts (humble object pattern, Phase 10).

import { AiRequestResult, EditOperation } from '../sidecar';

export interface DiffPreviewData {
    intent: string;
    label: string;
    result: AiRequestResult;
    summary?: string;
}

export function renderPreviewBody(options: DiffPreviewData): string {
    const { intent, result, summary } = options;
    const lines: string[] = [];
    lines.push(`# Project Spec AI — ${intent}`);
    if (summary) {
        lines.push('', summary);
    }
    lines.push('', `**Status:** ${result.kind}`);
    if (result.lint?.items) {
        const errors = result.lint.items.filter((i) => i.severity === 'error');
        const warnings = result.lint.items.filter((i) => i.severity === 'warning');
        lines.push(
            '',
            `**Lint:** ${errors.length} error(s), ${warnings.length} warning(s).`,
        );
        if (result.lint.items.length > 0) {
            lines.push('', '## Lint findings', '');
            for (const item of result.lint.items) {
                const code = item.code ? ` \`${item.code}\`` : '';
                lines.push(`- **${item.severity}**${code}: ${item.message}`);
            }
        }
    }
    if (result.advisory && result.advisory.length > 0) {
        lines.push('', '## Advisory findings', '');
        for (const item of result.advisory) {
            lines.push(`- ${JSON.stringify(item)}`);
        }
    }
    if (result.patch && result.patch.length > 0) {
        lines.push('', '## Proposed patch', '', '```json');
        lines.push(JSON.stringify(result.patch, null, 2));
        lines.push('```');
    } else {
        lines.push('', '_No patch operations._');
    }
    if (result.failures && result.failures.length > 0) {
        lines.push('', '## Failures', '');
        for (const f of result.failures) {
            lines.push(`- ${f}`);
        }
    }
    return lines.join('\n');
}

export function summarizeOperation(op: EditOperation): string {
    return `- ${op.op} \`${op.path}\``;
}
