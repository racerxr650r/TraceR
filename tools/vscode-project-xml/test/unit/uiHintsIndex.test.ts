// Phase 2.5b Slice C: tier-1 contract tests for the typed
// `uiHintsIndex` surface on `ProjectIoClient` and the embedded
// `_ui_hints_index` field on `ParsedProject`.
//
// The substantive behavioural coverage lives in the Python suite
// (test/test_project_io.py::UiHintsIndexTests). These tests pin the
// TypeScript wrapper: that the method exists, forwards through
// `request()`, and returns a value typed as `UiHintsIndexResult`; and
// that `ParsedProject._ui_hints_index` round-trips a `UiHintsIndex`.

import { strict as assert } from 'assert';
import {
    ParsedNode,
    ParsedNodesIndex,
    ParsedProject,
    ProjectIoClient,
    UiHintEntry,
    UiHintsIndex,
    UiHintsIndexResult,
} from '../../src/sidecar';

class FakeClient {
    public lastMethod: string | undefined;
    public lastParams: Record<string, unknown> | undefined;
    constructor(private readonly result: UiHintsIndex) {}
    async uiHintsIndex(
        params: Record<string, unknown> = {},
    ): Promise<UiHintsIndexResult> {
        this.lastMethod = 'ui_hints_index';
        this.lastParams = params;
        return { ui_hints_index: this.result };
    }
}

function asClient(c: FakeClient): ProjectIoClient {
    return c as unknown as ProjectIoClient;
}

const HLR_ENTRY: UiHintEntry = {
    tree_node: { label: '@id', id_attr: 'id', group: 'hlrs' },
    form: [
        { target: 'id', kind: 'attr', field: 'text', required: true },
        { target: 'name', kind: 'attr', field: 'text', required: false },
        { target: 'text', kind: 'child', field: 'textarea', required: true },
        { target: 'trace', kind: 'child', field: 'ref:HLR', required: false },
    ],
    lenses: [{ kind: 'coverage' }, { kind: 'tracesCount' }],
    document: false,
    element: 'hlr',
};

const DOCUMENT_ENTRY: UiHintEntry = {
    tree_node: null,
    form: [],
    lenses: [],
    document: true,
    element: 'document',
};

const SAMPLE_INDEX: UiHintsIndex = {
    Hlr: HLR_ENTRY,
    Document: DOCUMENT_ENTRY,
};

describe('ProjectIoClient.uiHintsIndex (Phase 2.5b Slice C)', () => {
    it('returns a typed UiHintsIndexResult', async () => {
        const fake = new FakeClient(SAMPLE_INDEX);
        const result = await asClient(fake).uiHintsIndex();
        assert.equal(fake.lastMethod, 'ui_hints_index');
        assert.deepEqual(fake.lastParams, {});
        assert.ok(result.ui_hints_index);
        const hlr = result.ui_hints_index['Hlr'];
        assert.equal(hlr.tree_node?.id_attr, 'id');
        assert.equal(hlr.form.length, 4);
        assert.equal(hlr.lenses[0].kind, 'coverage');
        assert.equal(hlr.document, false);
    });

    it('forwards optional xsd_path param', async () => {
        const fake = new FakeClient(SAMPLE_INDEX);
        await asClient(fake).uiHintsIndex({ xsd_path: '/tmp/project.xsd' });
        assert.deepEqual(fake.lastParams, { xsd_path: '/tmp/project.xsd' });
    });

    it('round-trips Document entry with no tree node', () => {
        const doc = SAMPLE_INDEX['Document'];
        assert.equal(doc.tree_node, null);
        assert.equal(doc.document, true);
        assert.equal(doc.form.length, 0);
    });
});

describe('ParsedProject._ui_hints_index (Phase 2.5b Slice C)', () => {
    it('accepts an embedded UiHintsIndex without widening the type', () => {
        const project: ParsedProject = {
            name: 'TraceR',
            schema_version: '1.4',
            _ui_hints_index: SAMPLE_INDEX,
        };
        assert.equal(project.schema_version, '1.4');
        assert.ok(project._ui_hints_index);
        assert.equal(project._ui_hints_index['Hlr'].form[0].kind, 'attr');
    });

    it('treats _ui_hints_index as optional (older sidecars)', () => {
        const project: ParsedProject = { name: 'Legacy' };
        assert.equal(project._ui_hints_index, undefined);
    });
});

describe('ParsedNode + _nodes (Phase 2.5b Slice D)', () => {
    it('UiHintEntry exposes the bound element name', () => {
        assert.equal(HLR_ENTRY.element, 'hlr');
        assert.equal(DOCUMENT_ENTRY.element, 'document');
    });

    it('ParsedProject._nodes accepts a generic node index', () => {
        const planNode: ParsedNode = {
            tag: 'plan',
            attrs: { version: '0.1' },
            ui: null,
            text: null,
        };
        const itemNode: ParsedNode = {
            tag: 'item',
            attrs: { id: 'P-001', status: 'done' },
            ui: { icon: 'check', color: 'charts.green' },
            text: 'Wire list_documents through the sidecar.',
        };
        const nodes: ParsedNodesIndex = {
            Plan: [planNode],
            'Plan/item': [itemNode],
        };
        const project: ParsedProject = {
            name: 'TraceR',
            schema_version: '1.4',
            _nodes: nodes,
        };
        assert.ok(project._nodes);
        assert.equal(project._nodes['Plan'].length, 1);
        assert.equal(project._nodes['Plan/item'][0].attrs.id, 'P-001');
        assert.equal(project._nodes['Plan/item'][0].ui?.icon, 'check');
    });

    it('treats _nodes as optional (older sidecars)', () => {
        const project: ParsedProject = { name: 'Legacy' };
        assert.equal(project._nodes, undefined);
    });
});
