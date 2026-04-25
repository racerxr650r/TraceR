// Lint-finding-driven badge index for the Project Spec tree.
//
// Phase 2.5 Slice E: the linter emits each finding with a stable
// internal `code` (e.g. `broken-trace`, `id-format`, `no-test`,
// `missing-template`). We project the message text onto the
// `HLR-NNN` and `LLR-XXX-NN` ids it mentions and classify each id
// by severity, so the tree provider can decorate the matching leaf
// nodes with a status badge:
//
//   ❌  any error finding mentions this id
//   ⚠  any warning finding mentions this id (and no error does)
//
// The lookup is keyed on `(tag, id)` because the same id namespace
// could in principle be reused for non-coverage payloads in the
// future; today only `'hlr'` and `'llr'` carry findings, so other
// tags fall through to `undefined`.

import { LintFinding } from '../sidecar';

export type BadgeSeverity = 'error' | 'warning';

const HLR_ID_RE = /\bHLR-\d+\b/g;
const LLR_ID_RE = /\bLLR-[A-Z0-9]+-\d+\b/g;

export class BadgeIndex {
    private readonly hlrs = new Map<string, BadgeSeverity>();
    private readonly llrs = new Map<string, BadgeSeverity>();

    add(severity: BadgeSeverity, message: string): void {
        for (const id of message.match(HLR_ID_RE) ?? []) {
            this.bump(this.hlrs, id, severity);
        }
        for (const id of message.match(LLR_ID_RE) ?? []) {
            this.bump(this.llrs, id, severity);
        }
    }

    private bump(
        store: Map<string, BadgeSeverity>,
        id: string,
        severity: BadgeSeverity,
    ): void {
        const prior = store.get(id);
        // Errors win ties; once an id is tagged as an error it stays
        // an error even if a warning also mentions it.
        if (prior === 'error') {
            return;
        }
        store.set(id, severity);
    }

    severityFor(tag: string, id: string): BadgeSeverity | undefined {
        if (tag === 'hlr') {
            return this.hlrs.get(id);
        }
        if (tag === 'llr') {
            return this.llrs.get(id);
        }
        return undefined;
    }

    badgeFor(tag: string, id: string): string | undefined {
        const sev = this.severityFor(tag, id);
        if (sev === 'error') {
            return '❌';
        }
        if (sev === 'warning') {
            return '⚠';
        }
        return undefined;
    }

    /** Total number of distinct ids carrying a badge. Used by tests
     *  and by callers that want to suppress empty UIs. */
    size(): number {
        return this.hlrs.size + this.llrs.size;
    }
}

export function buildBadgeIndex(
    items: readonly LintFinding[] | undefined,
): BadgeIndex {
    const idx = new BadgeIndex();
    if (!items) {
        return idx;
    }
    for (const f of items) {
        if (f.severity === 'error') {
            idx.add('error', f.message);
        } else if (f.severity === 'warning') {
            idx.add('warning', f.message);
        }
    }
    return idx;
}
