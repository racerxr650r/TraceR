import { strict as assert } from 'assert';
import { buildTooltip, decorateTooltips, buildCoverageIndex } from '../../src/treeView/coverageTooltips';
import { ParsedProject } from '../../src/sidecar';

function makeProject(): ParsedProject {
    return {
        hlrs: [{ number: 1, title: 'Core', hlrs: [
            { id: 'HLR-001', name: 'First', traces: [{ target: 'SDD', ref: '2.1' }] },
        ]}],
        llrs: [{ number: 1, name: 'core', llrs: [
            { id: 'LLR-C-01', traces: [{ target: 'HLR', ref: 'HLR-001' }] },
        ]}],
        tests: [{ path: 'test/test_core.py', tests: [
            { name: 'test_alpha', traces: [{ target: 'LLR', ref: 'LLR-C-01' }, { target: 'HLR', ref: 'HLR-001' }] },
        ]}],
    } as unknown as ParsedProject;
}

describe('coverageTooltips (wrapper)', () => {
    describe('buildTooltip', () => {
        it('returns MarkdownString for known hlr locator', () => {
            const idx = buildCoverageIndex(makeProject());
            const md = buildTooltip({ tag: 'hlr', value: 'HLR-001' }, idx);
            assert.ok(md);
            assert.ok(md.value.includes('HLR-001'));
            assert.equal(md.isTrusted, true);
        });

        it('returns MarkdownString for known llr locator', () => {
            const idx = buildCoverageIndex(makeProject());
            const md = buildTooltip({ tag: 'llr', value: 'LLR-C-01' }, idx);
            assert.ok(md);
            assert.ok(md.value.includes('LLR-C-01'));
        });

        it('returns MarkdownString for known test locator', () => {
            const idx = buildCoverageIndex(makeProject());
            const md = buildTooltip({ tag: 'test', value: 'test_alpha' }, idx);
            assert.ok(md);
            assert.ok(md.value.includes('test_alpha'));
        });

        it('returns undefined for unknown tag', () => {
            const idx = buildCoverageIndex(makeProject());
            assert.equal(buildTooltip({ tag: 'unknown', value: 'x' }, idx), undefined);
        });
    });

    describe('decorateTooltips', () => {
        it('decorates tree nodes with tooltips', () => {
            const roots = [
                { locator: { tag: 'hlr', value: 'HLR-001' }, children: [] },
                { locator: { tag: 'llr', value: 'LLR-C-01' }, children: [] },
                { locator: undefined, children: [] },
            ] as any[];
            decorateTooltips(roots, makeProject());
            assert.ok(roots[0].tooltip);
            assert.ok(roots[1].tooltip);
            assert.equal(roots[2].tooltip, undefined);
        });

        it('decorates nested children', () => {
            const child = { locator: { tag: 'test', value: 'test_alpha' }, children: undefined } as any;
            const roots = [{ locator: undefined, children: [child] }] as any[];
            decorateTooltips(roots, makeProject());
            assert.ok(child.tooltip);
        });
    });
});
