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

    it('emits replace ops for SddModule attrs and child fields in edit mode', () => {
        const base = '/sdd/modules/module[path=src/foo.ts]';
        const ops = buildOperations(
            {
                type: 'SddModule',
                title: 'Edit src/foo.ts',
                initial: {},
                basePath: base,
            },
            {
                path: 'src/foo.ts',
                title: 'Foo Module',
                purpose: 'Implements foo logic.',
                responsibility: 'Owns foo state.',
                data_structures: 'FooRecord',
                algorithm: 'Binary search.',
            },
            [
                { kind: 'attr',  target: 'path',            field: 'text',  required: false },
                { kind: 'attr',  target: 'title',           field: 'text',  required: false },
                { kind: 'child', target: 'purpose',         field: 'cdata', required: false },
                { kind: 'child', target: 'responsibility',  field: 'cdata', required: false },
                { kind: 'child', target: 'data_structures', field: 'cdata', required: false },
                { kind: 'child', target: 'algorithm',       field: 'cdata', required: false },
            ],
        );
        const paths = ops.map((o) => `${o.op} ${o.path}`).sort();
        assert.deepEqual(paths, [
            `replace ${base}/@path`,
            `replace ${base}/@title`,
            `replace ${base}/algorithm`,
            `replace ${base}/data_structures`,
            `replace ${base}/purpose`,
            `replace ${base}/responsibility`,
        ]);
    });

    it('emits replace ops for StpFixture attrs in edit mode', () => {
        const base = '/stp/integration_environment/fixture[name=rtps]';
        const ops = buildOperations(
            {
                type: 'StpFixture',
                title: 'Edit rtps',
                initial: {},
                basePath: base,
            },
            { name: 'rtps', source: 'docker compose up' },
            [
                { kind: 'attr', target: 'name',   field: 'text', required: true },
                { kind: 'attr', target: 'source', field: 'text', required: false },
            ],
        );
        const paths = ops.map((o) => `${o.op} ${o.path}`).sort();
        assert.deepEqual(paths, [
            `replace ${base}/@name`,
            `replace ${base}/@source`,
        ]);
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

// ---------- view/title dropdown menu (LLR-PSP-08) ----------

describe('package.json view/title menu contribution (LLR-PSP-08)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const manifest = require('../../package.json');
    const viewTitle: Array<{ command: string; when: string; group: string }> =
        manifest.contributes?.menus?.['view/title'] ?? [];
    const treeEntries = viewTitle.filter(
        (e) => e.when === 'view == projectXml.tree',
    );

    it('contributes the five expected commands to the tree view title menu', () => {
        const commands = treeEntries.map((e) => e.command);
        for (const cmd of [
            'projectXml.refresh',
            'projectXml.lint',
            'projectXml.renderAll',
            'projectXml.resolveMergeConflicts',
            'projectXml.initProject',
        ]) {
            assert.ok(
                commands.includes(cmd),
                `view/title menu missing command ${cmd}`,
            );
        }
    });

    it('groups actions and project commands into separate menu groups', () => {
        const actionEntries = treeEntries.filter((e) =>
            e.group.startsWith('1_actions'),
        );
        const projectEntries = treeEntries.filter((e) =>
            e.group.startsWith('2_project'),
        );
        assert.ok(actionEntries.length >= 3, 'expected at least 3 entries in 1_actions group');
        assert.ok(projectEntries.length >= 2, 'expected at least 2 entries in 2_project group');
    });

    it('keeps refresh in the navigation group as an icon button', () => {
        const navEntries = treeEntries.filter(
            (e) => e.group === 'navigation',
        );
        const navCommands = navEntries.map((e) => e.command);
        assert.ok(
            navCommands.includes('projectXml.refresh'),
            'refresh must remain in the navigation group',
        );
    });
});

// ---------- computeCoverage (LLR-FRM-08) ----------

import { computeCoverage } from '../../src/forms/FormPanelProvider';
import type { ParsedProject } from '../../src/sidecar';

function makeParsed(): ParsedProject {
    return {
        flat_hlrs: [
            {
                id: 'HLR-001', name: 'First HLR',
                traces: [{ target: 'SDD', ref: '3.1' }],
            },
            {
                id: 'HLR-002', name: 'Second HLR',
                traces: [{ target: 'SDD', ref: '3.2' }],
            },
        ],
        flat_llrs: [
            {
                id: 'LLR-A-01',
                traces: [{ target: 'HLR', ref: 'HLR-001' }],
            },
        ],
        flat_tests: [
            {
                name: 'test_alpha',
                file: 'test/test_alpha.py',
                traces: [
                    { target: 'HLR', ref: 'HLR-001' },
                    { target: 'LLR', ref: 'LLR-A-01' },
                ],
            },
        ],
    };
}

describe('computeCoverage (LLR-FRM-08 — inline coverage hints)', () => {
    it('computeCoverage returns downstream LLRs and tests for an HLR', () => {
        const info = computeCoverage(makeParsed(), 'Hlr', { id: 'HLR-001' });
        assert.ok(info);
        assert.ok(info.summary.includes('1 LLR'));
        assert.ok(info.summary.includes('1 test'));
        const llrSec = info.sections.find((s) => s.heading === 'Downstream LLRs');
        assert.ok(llrSec);
        assert.equal(llrSec.items[0].label, 'LLR-A-01');
        assert.equal(llrSec.items[0].tag, 'llr');
        const testSec = info.sections.find((s) => s.heading === 'Direct tests');
        assert.ok(testSec);
        assert.equal(testSec.items[0].label, 'test_alpha');
        assert.equal(testSec.items[0].sublabel, 'test/test_alpha.py');
    });

    it('computeCoverage returns upstream HLRs and tests for an LLR', () => {
        const info = computeCoverage(makeParsed(), 'Llr', { id: 'LLR-A-01' });
        assert.ok(info);
        assert.ok(info.summary.includes('1 HLR trace'));
        assert.ok(info.summary.includes('1 test'));
        const hlrSec = info.sections.find((s) => s.heading === 'Upstream HLRs');
        assert.ok(hlrSec);
        assert.equal(hlrSec.items[0].label, 'HLR-001');
        assert.equal(hlrSec.items[0].sublabel, 'First HLR');
        const testSec = info.sections.find((s) => s.heading === 'Tests');
        assert.ok(testSec);
        assert.equal(testSec.items[0].sublabel, 'test/test_alpha.py');
    });

    it('computeCoverage returns upstream traces for a test', () => {
        const info = computeCoverage(makeParsed(), 'Test', { name: 'test_alpha' });
        assert.ok(info);
        assert.ok(info.summary.includes('1 HLR'));
        assert.ok(info.summary.includes('1 LLR'));
        const hlrSec = info.sections.find((s) => s.heading === 'Upstream HLRs');
        assert.ok(hlrSec);
        assert.equal(hlrSec.items[0].label, 'HLR-001');
        const llrSec = info.sections.find((s) => s.heading === 'Upstream LLRs');
        assert.ok(llrSec);
        assert.equal(llrSec.items[0].label, 'LLR-A-01');
        // Source file section carries the parent file path as a clickable link
        const fileSec = info.sections.find((s) => s.heading === 'Source file');
        assert.ok(fileSec, 'expected a Source file section');
        assert.equal(fileSec.items[0].label, 'test/test_alpha.py');
        assert.equal(fileSec.items[0].tag, 'file');
        assert.equal(fileSec.items[0].value, 'test/test_alpha.py');
    });

    it('computeCoverage returns HLRs tracing to an SDD module', () => {
        const info = computeCoverage(makeParsed(), 'SddModule', { path: '3.1' });
        assert.ok(info);
        assert.ok(info.summary.includes('1 HLR'));
        const sec = info.sections.find((s) => s.heading === 'HLRs tracing to this module');
        assert.ok(sec);
        assert.equal(sec.items[0].label, 'HLR-001');
        assert.equal(sec.items[0].sublabel, 'First HLR');
    });

    it('computeCoverage propagates parent file path when flat_tests is absent', () => {
        // When the sidecar omits flat_tests, the coverage index falls
        // back to collectTests() which walks project.tests.  The file
        // path must be copied from the parent <file> entry onto each
        // test so that coverage sublabels render the clickable link.
        const nested: ParsedProject = {
            flat_hlrs: [
                { id: 'HLR-001', name: 'H1', traces: [{ target: 'SDD', ref: '3' }] },
            ],
            flat_llrs: [],
            // NO flat_tests — forces the nested fallback path
            tests: [
                {
                    path: 'test/test_nested.py',
                    tests: [
                        { name: 'test_n1', traces: [{ target: 'HLR', ref: 'HLR-001' }] },
                    ],
                },
            ],
        } as unknown as ParsedProject;
        const info = computeCoverage(nested, 'Hlr', { id: 'HLR-001' });
        assert.ok(info);
        const testSec = info.sections.find((s) => s.heading === 'Direct tests');
        assert.ok(testSec, 'expected a Direct tests section');
        assert.equal(testSec.items[0].sublabel, 'test/test_nested.py',
            'sublabel should carry the parent file path');
        assert.equal(testSec.items[0].tag, 'test');
    });
});

// ---------- resolveFormParams (coverage link → form navigation) ----------

import { resolveFormParams } from '../../src/forms/FormPanelProvider';

function makeNestedParsed(): ParsedProject {
    return {
        hlrs: [
            {
                number: '1', title: 'Section One',
                hlrs: [
                    { id: 'HLR-001', name: 'First HLR', traces: [] },
                ],
            },
        ],
        llrs: [
            {
                name: 'alpha', number: '1', title: 'Alpha',
                llrs: [
                    { id: 'LLR-A-01', traces: [] },
                ],
            },
        ],
        tests: [
            {
                path: 'test/test_alpha.py',
                tests: [
                    { name: 'test_alpha', purpose: 'test something', traces: [] },
                ],
            },
        ],
        sdd: {
            modules: [{
                path: '3.1',
                title: 'Module One',
                purpose: 'Does stuff.',
                responsibilities: ['Owns the thing.', 'Cleans up.'],
                data_structures: 'SomeStruct',
                algorithm: 'DFS traversal.',
            }],
        },
        stp: {
            integration_environment: {
                fixtures: [
                    { name: 'rtps', source: 'docker compose up' },
                ],
            },
        },
    } as unknown as ParsedProject;
}

describe('resolveFormParams (coverage link → open form)', () => {
    it('resolves an HLR locator to form params with correct basePath', () => {
        const result = resolveFormParams(
            makeNestedParsed(),
            { tag: 'hlr', value: 'HLR-001' },
        );
        assert.ok(result);
        assert.equal(result.type, 'Hlr');
        assert.equal(result.basePath, '/hlrs/section[number=1]/hlr[id=HLR-001]');
        assert.equal((result.initial as { id: string }).id, 'HLR-001');
    });

    it('resolves an LLR locator to form params with correct basePath', () => {
        const result = resolveFormParams(
            makeNestedParsed(),
            { tag: 'llr', value: 'LLR-A-01' },
        );
        assert.ok(result);
        assert.equal(result.type, 'Llr');
        assert.equal(result.basePath, '/llrs/function[number=1]/llr[id=LLR-A-01]');
    });

    it('resolves a test locator to form params with correct basePath', () => {
        const result = resolveFormParams(
            makeNestedParsed(),
            { tag: 'test', attr: 'name', value: 'test_alpha' },
        );
        assert.ok(result);
        assert.equal(result.type, 'Test');
        assert.equal(result.basePath, '/tests/file[path=test/test_alpha.py]/test[name=test_alpha]');
    });

    it('resolves an SDD module locator to form params with child fields', () => {
        const result = resolveFormParams(
            makeNestedParsed(),
            { tag: 'module', value: '3.1' },
        );
        assert.ok(result);
        assert.equal(result.type, 'SddModule');
        assert.equal(result.basePath, '/sdd/modules/module[path=3.1]');
        const init = result.initial as Record<string, unknown>;
        assert.equal(init.path, '3.1');
        assert.equal(init.title, 'Module One');
        assert.equal(init.purpose, 'Does stuff.');
        assert.equal(init.responsibility, 'Owns the thing.\nCleans up.');
        assert.equal(init.data_structures, 'SomeStruct');
        assert.equal(init.algorithm, 'DFS traversal.');
    });

    it('resolves an STP fixture locator to form params', () => {
        const result = resolveFormParams(
            makeNestedParsed(),
            { tag: 'fixture', attr: 'name', value: 'rtps' },
        );
        assert.ok(result);
        assert.equal(result.type, 'StpFixture');
        assert.equal(result.basePath, '/stp/integration_environment/fixture[name=rtps]');
        const init = result.initial as Record<string, unknown>;
        assert.equal(init.name, 'rtps');
        assert.equal(init.source, 'docker compose up');
    });

    it('returns undefined for a non-existent fixture', () => {
        const result = resolveFormParams(
            makeNestedParsed(),
            { tag: 'fixture', attr: 'name', value: 'nonexistent' },
        );
        assert.equal(result, undefined);
    });

    it('returns undefined for a non-existent item', () => {
        const result = resolveFormParams(
            makeNestedParsed(),
            { tag: 'hlr', value: 'HLR-999' },
        );
        assert.equal(result, undefined);
    });

    it('returns undefined for an unknown tag', () => {
        const result = resolveFormParams(
            makeNestedParsed(),
            { tag: 'unknown', value: 'X' },
        );
        assert.equal(result, undefined);
    });
});
