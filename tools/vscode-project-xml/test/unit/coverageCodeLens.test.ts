// Phase 2.5b Slice F: tier-1 tests for the schema-driven lens-target
// resolver in CoverageCodeLensProvider. Pins the seam that lets new
// payloads with a `<ui:lens kind="coverage"/>` annotation surface
// inline coverage lenses with no per-payload regex edits.

import { strict as assert } from 'assert';
import {
    _RELATED_DISPATCH,
    _SUPPORTED_LENS_KINDS,
    getLensTargets,
} from '../../src/codeLens/CoverageCodeLensProvider';
import { UiHintsIndex } from '../../src/sidecar';

const FULL_HINTS: UiHintsIndex = {
    Hlr: {
        tree_node: { label: '@id', id_attr: 'id', group: 'hlrs' },
        form: [],
        lenses: [{ kind: 'coverage' }, { kind: 'tracesCount' }],
        document: false,
        element: 'hlr',
    },
    Llr: {
        tree_node: { label: '@id', id_attr: 'id', group: 'llrs' },
        form: [],
        lenses: [{ kind: 'coverage' }],
        document: false,
        element: 'llr',
    },
    Test: {
        tree_node: { label: '@name', id_attr: 'name', group: 'tests' },
        form: [],
        lenses: [{ kind: 'tracesCount' }],
        document: false,
        element: 'test',
    },
    Document: {
        tree_node: null,
        form: [],
        lenses: [],
        document: true,
        element: 'document',
    },
    SddModule: {
        tree_node: { label: '@path', id_attr: 'path', group: 'sdd' },
        form: [],
        lenses: [],
        document: false,
        element: 'module',
    },
};

describe('getLensTargets (Phase 2.5b Slice F)', () => {
    it('falls back to legacy hlr/llr/test triple when hints are missing', () => {
        const targets = getLensTargets(undefined);
        assert.deepEqual(
            targets.map((t) => t.element),
            ['hlr', 'llr', 'test'],
        );
        assert.deepEqual(
            targets.map((t) => t.idAttr),
            ['id', 'id', 'name'],
        );
    });

    it('selects only entries whose lenses include a supported kind', () => {
        const targets = getLensTargets(FULL_HINTS);
        const elements = targets.map((t) => t.element).sort();
        assert.deepEqual(elements, ['hlr', 'llr', 'test']);
        // Document has no tree_node and no lenses → skipped.
        // SddModule has a tree_node but no supported lens → skipped.
        for (const t of targets) {
            assert.notEqual(t.element, 'document');
            assert.notEqual(t.element, 'module');
        }
    });

    it('reads idAttr from the schema tree_node, not from a hard-coded constant', () => {
        const targets = getLensTargets(FULL_HINTS);
        const test = targets.find((t) => t.element === 'test');
        assert.ok(test);
        assert.equal(test.idAttr, 'name');
    });

    it('falls back to legacy targets when the index has no supported lenses', () => {
        const sparse: UiHintsIndex = {
            Plan: {
                tree_node: { label: '@version', id_attr: 'version', group: 'plan' },
                form: [],
                lenses: [],
                document: false,
                element: 'plan',
            },
        };
        const targets = getLensTargets(sparse);
        assert.deepEqual(
            targets.map((t) => t.element),
            ['hlr', 'llr', 'test'],
        );
    });

    it('exposes the supported lens kinds for downstream callers', () => {
        assert.ok(_SUPPORTED_LENS_KINDS.has('coverage'));
        assert.ok(_SUPPORTED_LENS_KINDS.has('tracesCount'));
        assert.equal(_SUPPORTED_LENS_KINDS.has('foo'), false);
    });

    it('keeps the per-element related dispatch table aligned with legacy elements', () => {
        const keys = Object.keys(_RELATED_DISPATCH).sort();
        assert.deepEqual(keys, ['hlr', 'llr', 'test']);
    });
});
