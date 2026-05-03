import { strict as assert } from 'assert';
import {
    buildCoverageIndex,
    pluralize,
    revealCommandLink,
    tooltipMarkdownForHlr,
    tooltipMarkdownForLlr,
    tooltipMarkdownForTest,
} from '../../src/treeView/coverageTooltipLogic';
import { ParsedProject } from '../../src/sidecar';

function makeProject(): ParsedProject {
    return {
        hlrs: [
            { number: 1, title: 'Core', hlrs: [
                { id: 'HLR-001', name: 'First', traces: [{ target: 'SDD', ref: '2.1' }] },
            ]},
        ],
        llrs: [
            { number: 1, name: 'core', llrs: [
                { id: 'LLR-C-01', traces: [{ target: 'HLR', ref: 'HLR-001' }] },
            ]},
        ],
        tests: [
            { path: 'test/test_core.py', tests: [
                { name: 'test_alpha', traces: [{ target: 'LLR', ref: 'LLR-C-01' }, { target: 'HLR', ref: 'HLR-001' }] },
            ]},
        ],
    } as unknown as ParsedProject;
}

describe('coverageTooltipLogic', () => {
    describe('buildCoverageIndex', () => {
        it('populates all maps', () => {
            const idx = buildCoverageIndex(makeProject());
            assert.equal(idx.hlrById.size, 1);
            assert.equal(idx.llrById.size, 1);
            assert.equal(idx.testByName.size, 1);
            assert.equal(idx.llrsByHlr.get('HLR-001')?.length, 1);
            assert.equal(idx.testsByHlr.get('HLR-001')?.length, 1);
            assert.equal(idx.testsByLlr.get('LLR-C-01')?.length, 1);
        });
    });

    describe('tooltipMarkdownForHlr', () => {
        it('includes HLR id and coverage summary', () => {
            const idx = buildCoverageIndex(makeProject());
            const md = tooltipMarkdownForHlr('HLR-001', idx);
            assert.ok(md);
            assert.ok(md.includes('**HLR `HLR-001`**'));
            assert.ok(md.includes('First'));
            assert.ok(md.includes('1 LLR'));
            assert.ok(md.includes('1 test'));
            assert.ok(md.includes('Downstream LLRs'));
        });

        it('shows empty message when no coverage', () => {
            const idx = buildCoverageIndex({
                hlrs: [{ number: 1, hlrs: [{ id: 'HLR-099' }] }],
                llrs: [], tests: [],
            } as unknown as ParsedProject);
            const md = tooltipMarkdownForHlr('HLR-099', idx);
            assert.ok(md);
            assert.ok(md.includes('No downstream LLRs or tests yet'));
        });
    });

    describe('tooltipMarkdownForLlr', () => {
        it('includes upstream HLRs and tests', () => {
            const idx = buildCoverageIndex(makeProject());
            const md = tooltipMarkdownForLlr('LLR-C-01', idx);
            assert.ok(md);
            assert.ok(md.includes('**LLR `LLR-C-01`**'));
            assert.ok(md.includes('Upstream HLRs'));
            assert.ok(md.includes('Tests'));
        });

        it('shows empty message when no traces', () => {
            const idx = buildCoverageIndex({
                hlrs: [], llrs: [{ number: 1, name: 'f', llrs: [{ id: 'LLR-Z-01' }] }], tests: [],
            } as unknown as ParsedProject);
            const md = tooltipMarkdownForLlr('LLR-Z-01', idx);
            assert.ok(md);
            assert.ok(md.includes('No traces or tests yet'));
        });
    });

    describe('tooltipMarkdownForTest', () => {
        it('includes test name and traces', () => {
            const idx = buildCoverageIndex(makeProject());
            const md = tooltipMarkdownForTest('test_alpha', idx);
            assert.ok(md);
            assert.ok(md.includes('**Test `test_alpha`**'));
            assert.ok(md.includes('test/test_core.py'));
            assert.ok(md.includes('Upstream HLRs'));
            assert.ok(md.includes('Upstream LLRs'));
        });

        it('shows empty message for test with no traces', () => {
            const idx = buildCoverageIndex({
                hlrs: [], llrs: [],
                tests: [{ path: 'x.py', tests: [{ name: 'test_empty' }] }],
            } as unknown as ParsedProject);
            const md = tooltipMarkdownForTest('test_empty', idx);
            assert.ok(md);
            assert.ok(md.includes('No traces yet'));
        });
    });

    describe('revealCommandLink', () => {
        it('generates a command URI link', () => {
            const link = revealCommandLink('HLR-001', { tag: 'hlr', value: 'HLR-001' });
            assert.ok(link.includes('command:projectXml.revealInXml'));
            assert.ok(link.includes('`HLR-001`'));
        });
    });

    describe('pluralize', () => {
        it('singular for 1', () => { assert.equal(pluralize(1, 'test'), '1 test'); });
        it('plural for 0', () => { assert.equal(pluralize(0, 'test'), '0 tests'); });
    });
});
