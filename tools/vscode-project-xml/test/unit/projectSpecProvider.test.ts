// Phase 2.5b Slice E: tier-1 tests for the generic payload-node
// builder in ProjectSpecProvider. Pins the seam that lets new
// payloads (any complex type with a `<ui:treeNode/>` annotation)
// surface in the Project Spec view without TypeScript edits.

import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import {
    COVERED_TYPE_KEYS,
    _buildGenericPayloadNodes,
    _renderLabel,
    locatorMeta,
} from '../../src/treeView/ProjectSpecProvider';
import {
    ParsedNode,
    ParsedNodesIndex,
    ParsedProject,
    UiHintsIndex,
} from '../../src/sidecar';

const PLAN_HINT: UiHintsIndex = {
    Plan: {
        tree_node: { label: '@version', id_attr: 'version', group: 'plan' },
        form: [],
        lenses: [],
        document: false,
        element: 'plan',
    },
    'Plan/item': {
        tree_node: { label: '@id', id_attr: 'id', group: 'plan' },
        form: [],
        lenses: [],
        document: false,
        element: 'item',
    },
    Hlr: {
        tree_node: { label: '@id @name', id_attr: 'id', group: 'hlrs' },
        form: [],
        lenses: [],
        document: false,
        element: 'hlr',
    },
    Document: {
        tree_node: null,
        form: [],
        lenses: [],
        document: true,
        element: 'document',
    },
};

const PLAN_NODE: ParsedNode = {
    tag: 'plan',
    attrs: { version: '0.1' },
    ui: null,
    text: null,
};

const ITEM_NODES: ParsedNode[] = [
    {
        tag: 'item',
        attrs: { id: 'P-001', status: 'done' },
        ui: { icon: 'check' },
        text: 'Wire list_documents.',
    },
    {
        tag: 'item',
        attrs: { id: 'P-002', status: 'open' },
        ui: null,
        text: 'Lens provider rewrite.',
    },
];

function makeProject(nodes: ParsedNodesIndex): ParsedProject {
    return {
        name: 'TraceR',
        schema_version: '1.4',
        _ui_hints_index: PLAN_HINT,
        _nodes: nodes,
    };
}

describe('buildGenericPayloadNodes (Phase 2.5b Slice E)', () => {
    it('skips type-keys handled by the typed builders', () => {
        // Hlr is in COVERED_TYPE_KEYS even when present in _nodes.
        assert.ok(COVERED_TYPE_KEYS.has('Hlr'));
        const project = makeProject({
            Hlr: [{ tag: 'hlr', attrs: { id: 'HLR-001' }, ui: null, text: null }],
        });
        assert.deepEqual(_buildGenericPayloadNodes(project), []);
    });

    it('emits a top-level group per uncovered type-key', () => {
        const project = makeProject({
            Plan: [PLAN_NODE],
            'Plan/item': ITEM_NODES,
        });
        const groups = _buildGenericPayloadNodes(project);
        assert.equal(groups.length, 2);
        const labels = groups.map((g) => g.label);
        assert.ok(labels.includes('Plan (1)'));
        assert.ok(labels.includes('Plan/item (2)'));
    });

    it('attaches a reveal locator with the schema-declared id_attr', () => {
        const project = makeProject({ Plan: [PLAN_NODE] });
        const [planGroup] = _buildGenericPayloadNodes(project);
        const child = (planGroup.children ?? [])[0];
        assert.ok(child);
        assert.deepEqual(child.locator, {
            tag: 'plan',
            attr: 'version',
            value: '0.1',
        });
    });

    it('renders @attr substitution from the tree_node label template', () => {
        const project = makeProject({ 'Plan/item': ITEM_NODES });
        const [itemGroup] = _buildGenericPayloadNodes(project);
        const childLabels = (itemGroup.children ?? []).map((c) => c.label);
        assert.deepEqual(childLabels, ['P-001', 'P-002']);
    });

    it('applies ui hints (icon) to generic leaf nodes', () => {
        const project = makeProject({ 'Plan/item': ITEM_NODES });
        const [itemGroup] = _buildGenericPayloadNodes(project);
        const [first] = itemGroup.children ?? [];
        assert.ok(first.iconPath instanceof vscode.ThemeIcon);
        assert.equal((first.iconPath as vscode.ThemeIcon).id, 'check');
    });

    it('skips entries without a tree_node (e.g. Document)', () => {
        const project = makeProject({
            Document: [{ tag: 'document', attrs: { id: 'SDD' }, ui: null, text: null }],
        });
        assert.deepEqual(_buildGenericPayloadNodes(project), []);
    });

    it('returns [] when _nodes / _ui_hints_index are absent', () => {
        const project: ParsedProject = { name: 'Legacy' };
        assert.deepEqual(_buildGenericPayloadNodes(project), []);
    });

    it('emits an empty (None) group when a type has zero instances', () => {
        const project = makeProject({ Plan: [] });
        const [planGroup] = _buildGenericPayloadNodes(project);
        assert.equal(planGroup.label, 'Plan (0)');
        assert.equal(
            planGroup.collapsibleState,
            vscode.TreeItemCollapsibleState.None,
        );
    });
});

describe('_renderLabel (Phase 2.5b Slice E)', () => {
    const node = (attrs: Record<string, string>): ParsedNode => ({
        tag: 'x',
        attrs,
        ui: null,
        text: null,
    });

    it('substitutes @attr tokens', () => {
        assert.equal(_renderLabel('@id', node({ id: 'P-001' })), 'P-001');
    });

    it('joins multiple tokens', () => {
        assert.equal(
            _renderLabel('@id @name', node({ id: 'HLR-001', name: 'SoT' })),
            'HLR-001 SoT',
        );
    });

    it('drops dangling em-dash separators when a token is missing', () => {
        assert.equal(
            _renderLabel('@id — @name', node({ id: 'HLR-001' })),
            'HLR-001',
        );
    });

    it('collapses to empty string when no tokens resolve', () => {
        assert.equal(_renderLabel('@missing', node({})), '');
    });
});

describe('locatorMeta (Phase 2.5b Slice H)', () => {
    const hints: UiHintsIndex = {
        Test: {
            tree_node: { label: '@name', id_attr: 'name', group: 'tests' },
            form: [],
            lenses: [],
            document: false,
            element: 'test',
        },
        Hlr: {
            tree_node: { label: '@id', id_attr: 'id', group: 'hlrs' },
            form: [],
            lenses: [],
            document: false,
            element: 'hlr',
        },
    };

    it('reads tag + idAttr from the schema when present', () => {
        const meta = locatorMeta(hints, 'Test', 'fallback', 'fb');
        assert.deepEqual(meta, { tag: 'test', idAttr: 'name' });
    });

    it('falls back when the type key is absent', () => {
        const meta = locatorMeta(hints, 'Missing', 'fallback', 'fb');
        assert.deepEqual(meta, { tag: 'fallback', idAttr: 'fb' });
    });

    it('falls back when hints are undefined', () => {
        const meta = locatorMeta(undefined, 'Test', 'test', 'name');
        assert.deepEqual(meta, { tag: 'test', idAttr: 'name' });
    });

    it('falls back when the type entry has no tree_node', () => {
        const partial: UiHintsIndex = {
            Document: {
                tree_node: null,
                form: [],
                lenses: [],
                document: true,
                element: 'document',
            },
        };
        const meta = locatorMeta(partial, 'Document', 'document', 'id');
        assert.deepEqual(meta, { tag: 'document', idAttr: 'id' });
    });
});

// LLR-PSP-07: clicking a leaf opens the schema-driven popup edit dialog.
describe('leaf edit wiring (LLR-PSP-07)', () => {
    // Build a hint index with a form-annotated type ("Widget") and a
    // form-less type ("Plan") so we can verify the command is only
    // stamped on types that have editable form fields.
    const WIDGET_HINT: UiHintsIndex = {
        Widget: {
            tree_node: { label: '@id', id_attr: 'id', group: 'widgets' },
            form: [
                { target: 'id', kind: 'attr', field: 'text', required: true },
                { target: 'label', kind: 'attr', field: 'text', required: false },
            ],
            lenses: [],
            document: false,
            element: 'widget',
        },
        Plan: {
            tree_node: { label: '@version', id_attr: 'version', group: 'plan' },
            form: [],
            lenses: [],
            document: false,
            element: 'plan',
        },
    };

    const WIDGET_NODES: ParsedNode[] = [
        { tag: 'widget', attrs: { id: 'W-001', label: 'Alpha' }, ui: null, text: null },
        { tag: 'widget', attrs: { id: 'W-002', label: 'Beta' }, ui: null, text: null },
    ];

    function makeWidgetProject(nodes: ParsedNodesIndex): ParsedProject {
        return {
            name: 'TestProj',
            schema_version: '1.0',
            _ui_hints_index: WIDGET_HINT,
            _nodes: nodes,
        };
    }

    it('marks leaves as editable with editArgs when type has form fields', () => {
        const project = makeWidgetProject({ Widget: WIDGET_NODES });
        const [group] = _buildGenericPayloadNodes(project);
        const leaves = group.children ?? [];
        assert.equal(leaves.length, 2);
        for (const leaf of leaves) {
            assert.ok(leaf.editArgs, 'leaf should have editArgs');
            assert.equal(leaf.editArgs!.type, 'Widget');
            assert.ok(leaf.editArgs!.basePath.startsWith('/widget[id='));
            assert.ok(
                (leaf.contextValue ?? '').includes('editable'),
                'contextValue should include editable',
            );
        }
        // Verify first leaf's specific values.
        const first = leaves[0];
        assert.equal(first.editArgs!.basePath, '/widget[id=W-001]');
        assert.equal(first.editArgs!.title, 'Edit W-001');
        assert.deepEqual(first.editArgs!.formData, { id: 'W-001', label: 'Alpha' });
        // TreeItem.command should be set so single-click opens the dialog.
        assert.ok(first.command, 'leaf should have TreeItem.command');
        assert.equal(first.command!.command, 'projectXml.editPayload');
    });

    it('does not mark leaves as editable when type has no form fields', () => {
        const project = makeWidgetProject({
            Plan: [{ tag: 'plan', attrs: { version: '0.1' }, ui: null, text: null }],
        });
        const [group] = _buildGenericPayloadNodes(project);
        const leaf = (group.children ?? [])[0];
        assert.ok(leaf, 'leaf should exist');
        assert.equal(leaf.editArgs, undefined, 'leaf without form fields should not have editArgs');
        assert.ok(
            !(leaf.contextValue ?? '').includes('editable'),
            'contextValue should not include editable',
        );
        assert.equal(leaf.command, undefined, 'leaf without form fields should not have TreeItem.command');
    });

    it('does not mark leaves as editable when the id attribute is empty', () => {
        const project = makeWidgetProject({
            Widget: [{ tag: 'widget', attrs: { id: '', label: 'NoId' }, ui: null, text: null }],
        });
        const [group] = _buildGenericPayloadNodes(project);
        const leaf = (group.children ?? [])[0];
        assert.equal(leaf.editArgs, undefined, 'leaf with empty id should not have editArgs');
    });
});

describe('group node docId (Render & Preview from context menu)', () => {
    // Imports already available: ProjectSpecNode from the existing
    // test fixtures (the _buildGenericPayloadNodes export requires
    // only the public property we assert on).
    const { ProjectSpecNode } = require('../../src/treeView/ProjectSpecProvider');

    it('ProjectSpecNode exposes a docId property', () => {
        const node = new ProjectSpecNode('HLRs (5)', vscode.TreeItemCollapsibleState.Collapsed);
        assert.equal(node.docId, undefined, 'docId should be undefined by default');
        node.docId = 'HLRs';
        assert.equal(node.docId, 'HLRs');
    });
});
