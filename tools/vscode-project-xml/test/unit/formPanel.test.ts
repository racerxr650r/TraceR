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

// Phase 4: the form panel is now payload-agnostic. The
// attribute/child split must come from the schema-derived hint
// registry, not from a hard-coded `id`/`name` heuristic.
describe('buildOperations (Phase 4 — schema-driven attribute split)', () => {
    it('treats SddModule path/title as attributes and the rest as children', () => {
        const ops = buildOperations(
            {
                type: 'SddModule',
                title: 'New module',
                initial: {},
                appendPath: '/sdd/modules/module/-',
            },
            {
                path: 'src/foo.ts',
                title: 'Foo',
                purpose: 'Does foo.',
                responsibility: 'Owns the foo state.',
            },
            [
                { kind: 'attr',  target: 'path',           field: 'text',  required: true },
                { kind: 'attr',  target: 'title',          field: 'text',  required: true },
                { kind: 'child', target: 'purpose',        field: 'cdata', required: false },
                { kind: 'child', target: 'responsibility', field: 'cdata', required: false },
            ],
        );
        assert.equal(ops.length, 1);
        assert.deepEqual(ops[0].value, {
            '@path': 'src/foo.ts',
            '@title': 'Foo',
            purpose: 'Does foo.',
            responsibility: 'Owns the foo state.',
        });
    });

    it('treats StpFixture name/source as attributes', () => {
        const ops = buildOperations(
            {
                type: 'StpFixture',
                title: 'New fixture',
                initial: {},
                appendPath: '/stp/integration_environment/fixture/-',
            },
            { name: 'rtps', source: 'docker compose up' },
            [
                { kind: 'attr', target: 'name',   field: 'text', required: true },
                { kind: 'attr', target: 'source', field: 'text', required: false },
            ],
        );
        assert.deepEqual(ops[0].value, {
            '@name': 'rtps',
            '@source': 'docker compose up',
        });
    });

    it('treats TestFile path/role/count as attributes', () => {
        const ops = buildOperations(
            {
                type: 'TestFile',
                title: 'New test file',
                initial: {},
                appendPath: '/tests/file/-',
            },
            { path: 'test/test_x.py', role: 'unit', count: '4' },
            [
                { kind: 'attr', target: 'path',  field: 'text', required: true },
                { kind: 'attr', target: 'role',  field: 'text', required: false },
                { kind: 'attr', target: 'count', field: 'text', required: false },
            ],
        );
        assert.deepEqual(ops[0].value, {
            '@path': 'test/test_x.py',
            '@role': 'unit',
            '@count': '4',
        });
    });

    it('treats Test name as attribute and purpose as child body', () => {
        const ops = buildOperations(
            {
                type: 'Test',
                title: 'New test',
                initial: {},
                appendPath: '/tests/file[path=test/test_x.py]/test/-',
            },
            {
                name: 'parses_a_record',
                purpose: 'Verifies record parsing.',
                traces: [{ target: 'LLR', ref: 'LLR-CORE-01' }],
            },
            [
                { kind: 'attr',  target: 'name',    field: 'text',    required: true },
                { kind: 'child', target: 'purpose', field: 'cdata',   required: false },
                { kind: 'child', target: 'traces',  field: 'ref:LLR', required: false },
            ],
        );
        assert.deepEqual(ops[0].value, {
            '@name': 'parses_a_record',
            purpose: 'Verifies record parsing.',
            traces: { trace: [{ '@target': 'LLR', '@ref': 'LLR-CORE-01' }] },
        });
    });

    it('falls back to the id/name heuristic when no fields are supplied', () => {
        const ops = buildOperations(
            {
                type: 'Hlr',
                title: '',
                initial: {},
                appendPath: '/hlrs/section[number=1]/hlr/-',
            },
            { id: 'HLR-001', name: 'x', text: 'body' },
        );
        assert.deepEqual(ops[0].value, {
            '@id': 'HLR-001',
            '@name': 'x',
            text: 'body',
        });
    });
});

describe('package.json walkthrough contribution (Phase 4)', () => {
    // Lightweight manifest sanity — proves the seven-step welcome
    // walkthrough is wired up so VS Code's Get Started surface picks
    // it up.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const manifest = require('../../package.json');

    it('declares one walkthrough with seven steps in the documented order', () => {
        const walkthroughs = manifest.contributes?.walkthroughs;
        assert.ok(Array.isArray(walkthroughs), 'contributes.walkthroughs must be an array');
        assert.equal(walkthroughs.length, 1);
        const wt = walkthroughs[0];
        assert.equal(wt.id, 'projectXml.welcome');
        const ids = wt.steps.map((s: { id: string }) => s.id);
        assert.deepEqual(ids, [
            'init', 'addHlr', 'addLlr', 'addModule',
            'addTest', 'lint', 'render',
        ]);
    });

    it('every walkthrough step references an existing command via completionEvents', () => {
        const declaredCommands = new Set<string>(
            (manifest.contributes?.commands ?? []).map(
                (c: { command: string }) => c.command,
            ),
        );
        const wt = manifest.contributes.walkthroughs[0];
        for (const step of wt.steps) {
            for (const ev of step.completionEvents ?? []) {
                if (ev.startsWith('onCommand:')) {
                    const cmd = ev.slice('onCommand:'.length);
                    assert.ok(
                        declaredCommands.has(cmd),
                        `walkthrough step "${step.id}" references undeclared command ${cmd}`,
                    );
                }
            }
        }
    });
});
