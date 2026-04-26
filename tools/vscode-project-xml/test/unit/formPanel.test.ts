// Phase 3 unit tests: buildOperations (form-submission JSON Patch) and
// the addHlr / addLlr commands (path allocation + QuickPick wiring).

import { strict as assert } from 'assert';

import { buildOperations } from '../../src/forms/FormPanelProvider';

describe('buildOperations (Phase 3 — form submission → JSON Patch)', () => {
    it('emits a single add op with @attr keys when in add mode', () => {
        const ops = buildOperations(
            {
                type: 'Hlr',
                title: 'New HLR',
                initial: {},
                appendPath: '/hlrs/section[number=1]/hlr/-',
            },
            {
                id: 'HLR-099',
                name: 'A new requirement',
                text: 'Body of the requirement.',
                traces: [{ target: 'SDD', ref: '2.1' }],
            },
        );
        assert.equal(ops.length, 1);
        assert.equal(ops[0].op, 'add');
        assert.equal(ops[0].path, '/hlrs/section[number=1]/hlr/-');
        assert.deepEqual(ops[0].value, {
            '@id': 'HLR-099',
            '@name': 'A new requirement',
            text: 'Body of the requirement.',
            traces: { trace: [{ '@target': 'SDD', '@ref': '2.1' }] },
        });
    });

    it('emits one replace per attribute and per child in edit mode', () => {
        const base = '/hlrs/section[number=1]/hlr[id=HLR-001]';
        const ops = buildOperations(
            {
                type: 'Hlr',
                title: 'Edit HLR-001',
                initial: {},
                basePath: base,
            },
            {
                id: 'HLR-001',
                name: 'Renamed',
                text: 'Updated body.',
                traces: [{ target: 'HLR', ref: 'HLR-002' }],
            },
        );
        const paths = ops.map((o) => `${o.op} ${o.path}`).sort();
        assert.deepEqual(paths.sort(), [
            `replace ${base}/@id`,
            `replace ${base}/@name`,
            `replace ${base}/text`,
            `replace ${base}/traces`,
        ].sort());
    });

    it('drops empty trace name attributes', () => {
        const ops = buildOperations(
            {
                type: 'Llr', title: 'New LLR',
                initial: {}, appendPath: '/llrs/function[number=1]/llr/-',
            },
            {
                id: 'LLR-CORE-99',
                text: 't',
                traces: [
                    { target: 'HLR', ref: 'HLR-001', name: '' },
                    { target: 'HLR', ref: 'HLR-002', name: 'optional' },
                ],
            },
        );
        const value = ops[0].value as Record<string, unknown>;
        const traces = (value.traces as { trace: Array<Record<string, unknown>> }).trace;
        assert.equal(traces.length, 2);
        assert.deepEqual(traces[0], { '@target': 'HLR', '@ref': 'HLR-001' });
        assert.deepEqual(traces[1], {
            '@target': 'HLR', '@ref': 'HLR-002', '@name': 'optional',
        });
    });

    it('skips invalid trace rows', () => {
        const ops = buildOperations(
            {
                type: 'Hlr', title: '', initial: {},
                appendPath: '/hlrs/section[number=1]/hlr/-',
            },
            {
                id: 'HLR-099',
                name: 'x',
                traces: [
                    { target: 'SDD' }, // missing ref → dropped
                    null,
                    { ref: 'X' },     // missing target → dropped
                    { target: 'SDD', ref: '2.1' }, // kept
                ],
            },
        );
        const value = ops[0].value as Record<string, unknown>;
        const traces = (value.traces as { trace: Array<Record<string, unknown>> }).trace;
        assert.equal(traces.length, 1);
        assert.deepEqual(traces[0], { '@target': 'SDD', '@ref': '2.1' });
    });

    it('throws when neither basePath nor appendPath is supplied', () => {
        assert.throws(() => buildOperations(
            { type: 'Hlr', title: '', initial: {} },
            { id: 'HLR-001' },
        ));
    });
});
