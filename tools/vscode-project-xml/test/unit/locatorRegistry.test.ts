// Phase 2.5b Slice G: tier-1 tests for the schema-driven id-scan
// registry that backs `rangeForFinding`. The default registry
// preserves the legacy HLR/LLR scan; `buildIdScanRegistryFromHints`
// derives one from `_ui_hints_index` so payloads that the schema
// declares get diagnostic ranges with no locator edits.

import { strict as assert } from 'assert';
import {
    DEFAULT_ID_SCAN_REGISTRY,
    IdScanEntry,
    buildIdScanRegistryFromHints,
} from '../../src/util/locator';

describe('DEFAULT_ID_SCAN_REGISTRY (Phase 2.5b Slice G)', () => {
    it('preserves the legacy HLR / LLR scan order', () => {
        assert.equal(DEFAULT_ID_SCAN_REGISTRY.length, 2);
        assert.equal(DEFAULT_ID_SCAN_REGISTRY[0].tag, 'hlr');
        assert.equal(DEFAULT_ID_SCAN_REGISTRY[1].tag, 'llr');
        assert.equal(DEFAULT_ID_SCAN_REGISTRY[0].idAttr, 'id');
        assert.equal(DEFAULT_ID_SCAN_REGISTRY[1].idAttr, 'id');
    });

    it('matches HLR-NNN tokens', () => {
        const re = DEFAULT_ID_SCAN_REGISTRY[0].valuePattern;
        re.lastIndex = 0;
        assert.deepEqual('foo HLR-001 HLR-042 bar'.match(re), ['HLR-001', 'HLR-042']);
    });

    it('matches LLR-XXX-NN tokens', () => {
        const re = DEFAULT_ID_SCAN_REGISTRY[1].valuePattern;
        re.lastIndex = 0;
        assert.deepEqual(
            'See LLR-PCL-01 and LLR-XYZ-99'.match(re),
            ['LLR-PCL-01', 'LLR-XYZ-99'],
        );
    });
});

describe('buildIdScanRegistryFromHints (Phase 2.5b Slice G)', () => {
    const hints = {
        Hlr: {
            tree_node: { id_attr: 'id', label: '@id', group: 'hlrs' },
            element: 'hlr',
        },
        Llr: {
            tree_node: { id_attr: 'id', label: '@id', group: 'llrs' },
            element: 'llr',
        },
        Test: {
            tree_node: { id_attr: 'name', label: '@name', group: 'tests' },
            element: 'test',
        },
        Document: {
            tree_node: null,
            element: 'document',
        },
    };

    it('falls back to the default registry when hints are undefined', () => {
        assert.equal(
            buildIdScanRegistryFromHints(undefined),
            DEFAULT_ID_SCAN_REGISTRY,
        );
    });

    it('emits one entry per tree_node-bearing element', () => {
        const reg = buildIdScanRegistryFromHints(hints);
        const tags = reg.map((e: IdScanEntry) => e.tag).sort();
        assert.deepEqual(tags, ['hlr', 'llr', 'test']);
    });

    it('reads the schema id_attr (test → name, not id)', () => {
        const reg = buildIdScanRegistryFromHints(hints);
        const test = reg.find((e: IdScanEntry) => e.tag === 'test');
        assert.ok(test);
        assert.equal(test.idAttr, 'name');
    });

    it('uses per-tag overrides for HLR / LLR (preserving exact patterns)', () => {
        const reg = buildIdScanRegistryFromHints(hints);
        const hlr = reg.find((e: IdScanEntry) => e.tag === 'hlr');
        assert.ok(hlr);
        hlr.valuePattern.lastIndex = 0;
        assert.deepEqual('HLR-001 LLR-XYZ-99'.match(hlr.valuePattern), ['HLR-001']);
    });

    it('uses a generic ALL-CAPS-WITH-DASHES pattern for unknown tags', () => {
        const reg = buildIdScanRegistryFromHints(hints);
        const test = reg.find((e: IdScanEntry) => e.tag === 'test');
        assert.ok(test);
        test.valuePattern.lastIndex = 0;
        // Generic pattern: matches dash-separated upper tokens.
        // Test names usually look like `test_foo_bar`, which the
        // generic pattern correctly does NOT match -- the tag
        // resolution falls through to the quoted-token / element
        // branches in rangeForFinding.
        assert.deepEqual('test_foo_bar'.match(test.valuePattern), null);
    });

    it('falls back to the default registry when no hints are eligible', () => {
        const reg = buildIdScanRegistryFromHints({
            Document: { tree_node: null, element: 'document' },
        });
        assert.equal(reg, DEFAULT_ID_SCAN_REGISTRY);
    });
});
