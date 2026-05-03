import { strict as assert } from 'assert';
import {
    buildOperations,
    computeCoverage,
    escapeHtml,
    locatorFromBasePath,
    resolveFormParams,
} from '../../src/forms/formLogic';
import { ParsedProject } from '../../src/sidecar';

describe('formLogic', () => {
    describe('locatorFromBasePath', () => {
        it('extracts locator from hlr path', () => {
            const loc = locatorFromBasePath('/hlrs/section[number=1]/hlr[id=HLR-001]');
            assert.deepEqual(loc, { tag: 'hlr', value: 'HLR-001' });
        });
        it('extracts locator from test path with non-id attr', () => {
            const loc = locatorFromBasePath('/tests/file[path=t.py]/test[name=test_x]');
            assert.deepEqual(loc, { tag: 'test', attr: 'name', value: 'test_x' });
        });
        it('returns undefined for missing basePath', () => {
            assert.equal(locatorFromBasePath(undefined), undefined);
        });
        it('returns undefined for unparseable path', () => {
            assert.equal(locatorFromBasePath('/bare/path'), undefined);
        });
    });

    describe('escapeHtml', () => {
        it('escapes all special characters', () => {
            assert.equal(escapeHtml('<div class="a">x & y</div>'), '&lt;div class=&quot;a&quot;&gt;x &amp; y&lt;/div&gt;');
        });
        it('passes through safe strings', () => {
            assert.equal(escapeHtml('hello world'), 'hello world');
        });
    });

    describe('computeCoverage', () => {
        const project: ParsedProject = {
            hlrs: [{ number: 1, hlrs: [
                { id: 'HLR-001', name: 'A', traces: [{ target: 'SDD', ref: '2.1' }] },
            ]}],
            llrs: [{ number: 1, name: 'f', llrs: [
                { id: 'LLR-C-01', traces: [{ target: 'HLR', ref: 'HLR-001' }] },
            ]}],
            tests: [{ path: 't.py', tests: [
                { name: 'test_a', traces: [{ target: 'LLR', ref: 'LLR-C-01' }] },
            ]}],
            sdd: { modules: [{ path: 'src/x.ts' }] },
        } as unknown as ParsedProject;

        it('computes HLR coverage', () => {
            const info = computeCoverage(project, 'Hlr', { id: 'HLR-001' });
            assert.ok(info);
            assert.ok(info.summary.includes('LLR'));
        });

        it('computes LLR coverage', () => {
            const info = computeCoverage(project, 'Llr', { id: 'LLR-C-01' });
            assert.ok(info);
            assert.ok(info.summary.includes('HLR'));
        });

        it('computes Test coverage', () => {
            const info = computeCoverage(project, 'Test', { name: 'test_a' });
            assert.ok(info);
        });

        it('computes SddModule coverage', () => {
            const info = computeCoverage(project, 'SddModule', { path: 'src/x.ts' });
            assert.ok(info);
        });

        it('returns undefined for unknown type', () => {
            assert.equal(computeCoverage(project, 'Unknown', {}), undefined);
        });

        it('returns undefined for empty id', () => {
            assert.equal(computeCoverage(project, 'Hlr', { id: '' }), undefined);
        });
    });

    describe('resolveFormParams', () => {
        const project: ParsedProject = {
            hlrs: [{ number: 1, hlrs: [{ id: 'HLR-001', name: 'A' }] }],
            llrs: [{ number: 1, name: 'f', llrs: [{ id: 'LLR-C-01' }] }],
            tests: [{ path: 't.py', tests: [{ name: 'test_a' }] }],
            sdd: { modules: [{ path: 'src/x.ts' }] },
        } as unknown as ParsedProject;

        it('resolves hlr locator', () => {
            const params = resolveFormParams(project, { tag: 'hlr', value: 'HLR-001' });
            assert.ok(params);
            assert.equal(params.type, 'Hlr');
            assert.ok(params.basePath?.includes('HLR-001'));
        });

        it('resolves llr locator', () => {
            const params = resolveFormParams(project, { tag: 'llr', value: 'LLR-C-01' });
            assert.ok(params);
            assert.equal(params.type, 'Llr');
        });

        it('resolves test locator', () => {
            const params = resolveFormParams(project, { tag: 'test', value: 'test_a' });
            assert.ok(params);
            assert.equal(params.type, 'Test');
        });

        it('resolves module locator', () => {
            const params = resolveFormParams(project, { tag: 'module', value: 'src/x.ts' });
            assert.ok(params);
            assert.equal(params.type, 'SddModule');
        });

        it('returns undefined for unknown tag', () => {
            assert.equal(resolveFormParams(project, { tag: 'unknown', value: 'x' }), undefined);
        });

        it('returns undefined for missing item', () => {
            assert.equal(resolveFormParams(project, { tag: 'hlr', value: 'HLR-999' }), undefined);
        });

        it('returns undefined for missing llr', () => {
            assert.equal(resolveFormParams(project, { tag: 'llr', value: 'LLR-NOPE' }), undefined);
        });

        it('returns undefined for missing test', () => {
            assert.equal(resolveFormParams(project, { tag: 'test', value: 'test_nope' }), undefined);
        });

        it('returns undefined for missing module', () => {
            assert.equal(resolveFormParams(project, { tag: 'module', value: 'nope.ts' }), undefined);
        });
    });

    describe('buildOperations (re-exported)', () => {
        it('emits add op in add mode', () => {
            const ops = buildOperations(
                { type: 'Hlr', title: '', initial: {}, appendPath: '/hlrs/hlr/-' },
                { id: 'HLR-001', name: 'A' },
            );
            assert.equal(ops.length, 1);
            assert.equal(ops[0].op, 'add');
        });
    });
});
