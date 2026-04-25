// Phase 2.5b Slice E: tier-1 tests for the generic payload-node
// builder in ProjectSpecProvider. Pins the seam that lets new
// payloads (any complex type with a `<ui:treeNode/>` annotation)
// surface in the Project Spec view without TypeScript edits.

import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import {
    COVERED_TYPE_KEYS,
    ProjectSpecNode,
    _buildGenericPayloadNodes,
    _renderLabel,
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
