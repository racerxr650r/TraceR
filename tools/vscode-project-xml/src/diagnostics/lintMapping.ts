// Pure diagnostic-descriptor computation extracted from
// LintDiagnosticsProvider.ts (humble object pattern, Phase 10).

import { LintFinding, LintResult } from '../sidecar';

export const DIAGNOSTIC_SOURCE = 'projectXml';

export type SeverityLevel = 'error' | 'warning' | 'info';

export const SEVERITY_MAP: Record<string, SeverityLevel> = {
    error: 'error',
    warning: 'warning',
    note: 'info',
};

export interface DiagnosticDescriptor {
    message: string;
    severity: SeverityLevel;
    code?: string;
}

export function mapFindingSeverity(severity: string): SeverityLevel {
    return SEVERITY_MAP[severity] ?? 'info';
}

export function findingToDescriptor(item: LintFinding): DiagnosticDescriptor {
    return {
        message: item.message,
        severity: mapFindingSeverity(item.severity),
        code: item.code || undefined,
    };
}

export function resultToDescriptors(result: LintResult): DiagnosticDescriptor[] {
    if (result.items && result.items.length > 0) {
        return result.items.map(findingToDescriptor);
    }
    const out: DiagnosticDescriptor[] = [];
    for (const msg of result.errors) {
        out.push({ message: msg, severity: 'error' });
    }
    for (const msg of result.warnings) {
        out.push({ message: msg, severity: 'warning' });
    }
    for (const msg of result.notes) {
        out.push({ message: msg, severity: 'info' });
    }
    return out;
}
