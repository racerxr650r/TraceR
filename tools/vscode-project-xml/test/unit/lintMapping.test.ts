import { strict as assert } from 'assert';
import {
    DIAGNOSTIC_SOURCE,
    mapFindingSeverity,
    findingToDescriptor,
    resultToDescriptors,
    SEVERITY_MAP,
} from '../../src/diagnostics/lintMapping';

describe('lintMapping', () => {
    describe('DIAGNOSTIC_SOURCE', () => {
        it('is projectXml', () => {
            assert.equal(DIAGNOSTIC_SOURCE, 'projectXml');
        });
    });

    describe('SEVERITY_MAP', () => {
        it('maps error/warning/note', () => {
            assert.equal(SEVERITY_MAP.error, 'error');
            assert.equal(SEVERITY_MAP.warning, 'warning');
            assert.equal(SEVERITY_MAP.note, 'info');
        });
    });

    describe('mapFindingSeverity', () => {
        it('maps known severities', () => {
            assert.equal(mapFindingSeverity('error'), 'error');
            assert.equal(mapFindingSeverity('warning'), 'warning');
            assert.equal(mapFindingSeverity('note'), 'info');
        });

        it('defaults unknown to info', () => {
            assert.equal(mapFindingSeverity('unknown'), 'info');
            assert.equal(mapFindingSeverity(''), 'info');
        });
    });

    describe('findingToDescriptor', () => {
        it('maps a structured finding', () => {
            const d = findingToDescriptor({
                severity: 'error',
                message: 'broken ref HLR-999',
                code: 'broken-trace',
            });
            assert.deepEqual(d, {
                message: 'broken ref HLR-999',
                severity: 'error',
                code: 'broken-trace',
            });
        });

        it('omits code when empty', () => {
            const d = findingToDescriptor({
                severity: 'warning',
                message: 'no test',
                code: '',
            });
            assert.equal(d.code, undefined);
        });

        it('omits code when absent', () => {
            const d = findingToDescriptor({
                severity: 'note',
                message: 'info msg',
                code: null,
            });
            assert.equal(d.code, undefined);
        });
    });

    describe('resultToDescriptors', () => {
        it('prefers structured items when present', () => {
            const result = {
                errors: ['e1'],
                warnings: ['w1'],
                notes: ['n1'],
                ok: false,
                items: [
                    { severity: 'error' as const, message: 'structured err', code: 'c1' },
                ],
            };
            const descs = resultToDescriptors(result);
            assert.equal(descs.length, 1);
            assert.equal(descs[0].message, 'structured err');
            assert.equal(descs[0].code, 'c1');
        });

        it('falls back to legacy string lists', () => {
            const result = {
                errors: ['err1', 'err2'],
                warnings: ['warn1'],
                notes: ['note1'],
                ok: false,
                items: [],
            };
            const descs = resultToDescriptors(result);
            assert.equal(descs.length, 4);
            assert.deepEqual(descs.map(d => d.severity), ['error', 'error', 'warning', 'info']);
            assert.deepEqual(descs.map(d => d.message), ['err1', 'err2', 'warn1', 'note1']);
        });

        it('returns empty for empty result', () => {
            const descs = resultToDescriptors({ errors: [], warnings: [], notes: [], ok: true, items: [] });
            assert.equal(descs.length, 0);
        });
    });
});
