import { strict as assert } from 'assert';
import {
    buildIndex,
    buildElementIdRegex,
    collectHlrs,
    collectLlrs,
    collectTests,
    computeLensDescriptors,
    defaultSummary,
    findTestByName,
    getLensTargets,
    matchAll,
    MAX_INLINE_LENSES,
    PICK_RELATED_COMMAND,
    pluralize,
    RELATED_DISPATCH,
    relatedForHlr,
    relatedForLlr,
    relatedForTest,
    REVEAL_COMMAND,
    summaryForHlr,
    summaryForLlr,
    summaryForTest,
    SUPPORTED_LENS_KINDS,
} from '../../src/codeLens/coverageLensLogic';
import { ParsedProject, UiHintsIndex } from '../../src/sidecar';

function makeProject(): ParsedProject {
    return {
        hlrs: [
            {
                number: 1,
                title: 'Core',
                hlrs: [
                    { id: 'HLR-001', name: 'First', traces: [{ target: 'SDD', ref: '2.1' }] },
                    { id: 'HLR-002', name: 'Second' },
                ],
            },
        ],
        llrs: [
            {
                number: 1,
                name: 'core',
                llrs: [
                    { id: 'LLR-C-01', traces: [{ target: 'HLR', ref: 'HLR-001' }] },
                    { id: 'LLR-C-02', traces: [{ target: 'HLR', ref: 'HLR-001' }] },
                ],
            },
        ],
        tests: [
            {
                path: 'test/test_core.py',
                tests: [
                    { name: 'test_alpha', traces: [{ target: 'LLR', ref: 'LLR-C-01' }, { target: 'HLR', ref: 'HLR-002' }] },
                    { name: 'test_beta', traces: [{ target: 'HLR', ref: 'HLR-001' }] },
                ],
            },
        ],
    } as unknown as ParsedProject;
}

describe('coverageLensLogic', () => {
    describe('buildIndex', () => {
        it('indexes HLRs, LLRs, and tests', () => {
            const idx = buildIndex(makeProject());
            assert.equal(idx.hlrById.size, 2);
            assert.equal(idx.llrById.size, 2);
            assert.equal(idx.llrsByHlr.get('HLR-001')?.length, 2);
            assert.equal(idx.testsByHlr.get('HLR-001')?.length, 1);
            assert.equal(idx.testsByHlr.get('HLR-002')?.length, 1);
            assert.equal(idx.testsByLlr.get('LLR-C-01')?.length, 1);
        });
    });

    describe('relatedForHlr', () => {
        it('returns LLRs and tests related to an HLR', () => {
            const idx = buildIndex(makeProject());
            const items = relatedForHlr('HLR-001', idx);
            assert.equal(items.length, 3); // 2 LLRs + 1 test
            assert.ok(items.some(i => i.label === 'LLR-C-01'));
            assert.ok(items.some(i => i.label === 'test_beta'));
        });

        it('returns empty for unknown HLR', () => {
            const idx = buildIndex(makeProject());
            assert.deepEqual(relatedForHlr('HLR-999', idx), []);
        });
    });

    describe('relatedForLlr', () => {
        it('returns upstream HLRs and tests', () => {
            const idx = buildIndex(makeProject());
            const items = relatedForLlr('LLR-C-01', idx);
            assert.ok(items.some(i => i.label === 'HLR-001' && i.description === 'HLR'));
            assert.ok(items.some(i => i.label === 'test_alpha' && i.description === 'test'));
        });
    });

    describe('relatedForTest', () => {
        it('returns upstream LLRs and HLRs', () => {
            const idx = buildIndex(makeProject());
            const items = relatedForTest('test_alpha', idx);
            assert.ok(items.some(i => i.label === 'LLR-C-01'));
            assert.ok(items.some(i => i.label === 'HLR-002'));
        });
    });

    describe('findTestByName', () => {
        it('finds a test in the index', () => {
            const idx = buildIndex(makeProject());
            const t = findTestByName(idx, 'test_alpha');
            assert.ok(t);
            assert.equal(t.name, 'test_alpha');
        });

        it('returns undefined for unknown test', () => {
            const idx = buildIndex(makeProject());
            assert.equal(findTestByName(idx, 'nonexistent'), undefined);
        });
    });

    describe('summary functions', () => {
        it('summaryForHlr', () => {
            assert.equal(summaryForHlr([
                { label: 'a', description: 'LLR', locator: { tag: 'llr', value: 'a' } },
                { label: 'b', description: 'test', locator: { tag: 'test', value: 'b' } },
            ]), '1 LLR \u00b7 1 test');
        });

        it('summaryForLlr', () => {
            assert.equal(summaryForLlr([
                { label: 'a', description: 'HLR', locator: { tag: 'hlr', value: 'a' } },
            ]), '1 HLR \u00b7 0 tests');
        });

        it('summaryForTest', () => {
            assert.equal(summaryForTest([]), '0 LLRs \u00b7 0 HLRs');
        });

        it('defaultSummary', () => {
            assert.equal(defaultSummary([
                { label: 'x', locator: { tag: 'a', value: 'x' } },
            ]), '1 related');
        });
    });

    describe('pluralize', () => {
        it('singular for 1', () => { assert.equal(pluralize(1, 'item'), '1 item'); });
        it('plural for 0', () => { assert.equal(pluralize(0, 'item'), '0 items'); });
        it('plural for 2', () => { assert.equal(pluralize(2, 'item'), '2 items'); });
    });

    describe('buildElementIdRegex', () => {
        it('matches hlr id attributes', () => {
            const re = buildElementIdRegex('hlr', 'id');
            const text = '<hlr id="HLR-001" name="x">';
            const m = re.exec(text);
            assert.ok(m);
            assert.equal(m[1], 'HLR-001');
        });

        it('matches test name attributes', () => {
            const re = buildElementIdRegex('test', 'name');
            const text = '<test name="test_alpha">';
            const m = re.exec(text);
            assert.ok(m);
            assert.equal(m[1], 'test_alpha');
        });
    });

    describe('matchAll', () => {
        it('yields all matches', () => {
            const re = /<hlr id="([^"]+)"/g;
            const text = '<hlr id="A"/> <hlr id="B"/>';
            const results = [...matchAll(text, re)];
            assert.equal(results.length, 2);
            assert.equal(results[0][1], 'A');
            assert.equal(results[1][1], 'B');
        });
    });

    describe('computeLensDescriptors', () => {
        it('emits no-coverage lens when related is empty', () => {
            const descs = computeLensDescriptors('0 LLRs', 'HLR HLR-001', []);
            assert.equal(descs.length, 1);
            assert.ok(descs[0].title.includes('no coverage'));
        });

        it('emits summary + inline lenses for related items', () => {
            const related = [
                { label: 'LLR-C-01', description: 'LLR', locator: { tag: 'llr', value: 'LLR-C-01' } },
                { label: 'test_a', description: 'test', locator: { tag: 'test', attr: 'name', value: 'test_a' } },
            ];
            const descs = computeLensDescriptors('1 LLR \u00b7 1 test', 'HLR HLR-001', related);
            assert.equal(descs.length, 3); // summary + 2 inline
            assert.equal(descs[0].command, PICK_RELATED_COMMAND);
            assert.equal(descs[1].command, REVEAL_COMMAND);
        });

        it('adds overflow lens when related exceeds MAX_INLINE_LENSES', () => {
            const related = Array.from({ length: MAX_INLINE_LENSES + 2 }, (_, i) => ({
                label: `LLR-${i}`,
                description: 'LLR',
                locator: { tag: 'llr', value: `LLR-${i}` },
            }));
            const descs = computeLensDescriptors('8 LLRs', 'HLR X', related);
            // summary + MAX_INLINE_LENSES inline + 1 overflow
            assert.equal(descs.length, 1 + MAX_INLINE_LENSES + 1);
            assert.ok(descs[descs.length - 1].title.includes('more'));
        });
    });

    describe('collection helpers', () => {
        it('collectHlrs flattens sections', () => {
            assert.equal(collectHlrs(makeProject()).length, 2);
        });
        it('collectLlrs flattens groups', () => {
            assert.equal(collectLlrs(makeProject()).length, 2);
        });
        it('collectTests flattens files', () => {
            assert.equal(collectTests(makeProject()).length, 2);
        });
    });

    describe('getLensTargets', () => {
        it('falls back to legacy when no hints', () => {
            const targets = getLensTargets(undefined);
            assert.deepEqual(targets.map(t => t.element), ['hlr', 'llr', 'test']);
        });
    });
});
