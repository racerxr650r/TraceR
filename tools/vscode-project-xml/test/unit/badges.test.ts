import * as assert from 'assert';
import { BadgeIndex, buildBadgeIndex } from '../../src/util/badges';
import { LintFinding } from '../../src/sidecar';

function f(
    severity: 'error' | 'warning' | 'note',
    message: string,
    code: string | null = null,
): LintFinding {
    return { severity, message, code };
}

describe('util/badges', () => {
    describe('buildBadgeIndex', () => {
        it('marks HLR ids cited by warnings with ⚠', () => {
            const idx = buildBadgeIndex([
                f('warning', 'HLR HLR-001 has no test verifying it', 'no-test'),
            ]);
            assert.strictEqual(idx.badgeFor('hlr', 'HLR-001'), '⚠');
        });

        it('marks LLR ids cited by warnings with ⚠', () => {
            const idx = buildBadgeIndex([
                f('warning', 'LLR LLR-MET-04 has no verifying test', 'no-test'),
            ]);
            assert.strictEqual(idx.badgeFor('llr', 'LLR-MET-04'), '⚠');
        });

        it('marks ids cited by errors with ❌', () => {
            const idx = buildBadgeIndex([
                f('error', 'broken trace HLR HLR-007 missing', 'broken-trace'),
            ]);
            assert.strictEqual(idx.badgeFor('hlr', 'HLR-007'), '❌');
        });

        it('errors win over warnings when both cite the same id', () => {
            // The id is referenced first as a warning, then as an
            // error; the error must take precedence so the most
            // severe state is what the user sees.
            const idx = buildBadgeIndex([
                f('warning', 'HLR HLR-002 has no test', 'no-test'),
                f('error', 'broken trace to HLR-002', 'broken-trace'),
            ]);
            assert.strictEqual(idx.badgeFor('hlr', 'HLR-002'), '❌');

            // Reverse order — same outcome.
            const idx2 = buildBadgeIndex([
                f('error', 'broken trace to HLR-003', 'broken-trace'),
                f('warning', 'HLR HLR-003 has no test', 'no-test'),
            ]);
            assert.strictEqual(idx2.badgeFor('hlr', 'HLR-003'), '❌');
        });

        it('returns undefined for ids that no finding mentions', () => {
            const idx = buildBadgeIndex([
                f('warning', 'HLR HLR-001 has no test', 'no-test'),
            ]);
            assert.strictEqual(idx.badgeFor('hlr', 'HLR-999'), undefined);
            assert.strictEqual(idx.badgeFor('llr', 'LLR-XXX-99'), undefined);
        });

        it('ignores notes (info-only findings carry no badge)', () => {
            const idx = buildBadgeIndex([
                f('note', 'mentioning HLR-001 informationally'),
            ]);
            assert.strictEqual(idx.badgeFor('hlr', 'HLR-001'), undefined);
        });

        it('handles undefined items (no lint result yet)', () => {
            const idx = buildBadgeIndex(undefined);
            assert.strictEqual(idx.size(), 0);
            assert.strictEqual(idx.badgeFor('hlr', 'HLR-001'), undefined);
        });

        it('does not return a badge for unrelated tags (test, file)', () => {
            const idx = buildBadgeIndex([
                f('warning', 'HLR HLR-001 has no test', 'no-test'),
            ]);
            assert.strictEqual(idx.badgeFor('test', 'test_foo'), undefined);
            assert.strictEqual(idx.badgeFor('file', 'test/foo.py'), undefined);
        });

        it('extracts every id mentioned in a single message', () => {
            // The renderer can cite an HLR and an LLR in the same
            // finding (e.g. "broken trace from LLR-LNT-04 to
            // HLR-999"); both ids should pick up a badge.
            const idx = buildBadgeIndex([
                f(
                    'error',
                    'broken trace from LLR-LNT-04 to HLR-999',
                    'broken-trace',
                ),
            ]);
            assert.strictEqual(idx.badgeFor('llr', 'LLR-LNT-04'), '❌');
            assert.strictEqual(idx.badgeFor('hlr', 'HLR-999'), '❌');
        });
    });

    describe('BadgeIndex.severityFor', () => {
        it('exposes the raw severity for callers that need finer control', () => {
            const idx = new BadgeIndex();
            idx.add('warning', 'HLR-005 mentioned');
            idx.add('error', 'LLR-LNT-01 cited');
            assert.strictEqual(idx.severityFor('hlr', 'HLR-005'), 'warning');
            assert.strictEqual(idx.severityFor('llr', 'LLR-LNT-01'), 'error');
            assert.strictEqual(idx.severityFor('hlr', 'HLR-999'), undefined);
        });
    });
});
