// Phase 5b — tier-1 unit tests for the intent registry mirror.
import { strict as assert } from 'assert';
import {
    INTENTS,
    getIntent,
    intentForSlash,
    intentsForActions,
    slashCommands,
} from '../../src/ai/intents';

describe('ai/intents', () => {
    it('exposes every registered intent with id, label, kind, slash', () => {
        assert.ok(INTENTS.length >= 10, 'expected ≥10 intents');
        for (const i of INTENTS) {
            assert.ok(i.id, `intent missing id`);
            assert.ok(i.label, `intent ${i.id} missing label`);
            assert.match(i.kind, /^(authoring|pvd|advisory)$/);
            assert.ok(i.slash, `intent ${i.id} missing slash`);
        }
    });

    it('matches the Phase 5a Python registry by id and slash', () => {
        const ids = INTENTS.map((i) => i.id).sort();
        assert.deepEqual(ids, [
            'draft.hlr',
            'draft.llr',
            'draft.module',
            'draft.pvd',
            'draft.test',
            'expand.hlr_to_llrs',
            'expand.llr_to_tests',
            'gap.fix',
            'review.item',
            'suggest.traces',
        ]);
        const slashes = slashCommands().slice().sort();
        assert.deepEqual(slashes, [
            'draft-hlr',
            'draft-llr',
            'draft-module',
            'draft-pvd',
            'draft-test',
            'expand',
            'gap-fill',
            'review',
            'suggest-traces',
        ]);
    });

    it('getIntent returns the matching spec or undefined', () => {
        assert.equal(getIntent('draft.hlr')?.slash, 'draft-hlr');
        assert.equal(getIntent('nope'), undefined);
    });

    it('intentForSlash disambiguates /expand on target type', () => {
        assert.equal(intentForSlash('expand', 'Hlr')?.id, 'expand.hlr_to_llrs');
        assert.equal(intentForSlash('expand', 'Llr')?.id, 'expand.llr_to_tests');
        // Without target, picks the first declared (HLR-flavour).
        assert.equal(intentForSlash('expand')?.id, 'expand.hlr_to_llrs');
    });

    it('intentForSlash returns undefined for unknown commands', () => {
        assert.equal(intentForSlash('not-a-slash'), undefined);
    });

    it('intentsForActions filters & preserves registry order', () => {
        const got = intentsForActions(['suggest.traces', 'draft.hlr', 'gap.fix']);
        // Registry order: draft.hlr (index 1), suggest.traces (8), gap.fix (9).
        assert.deepEqual(
            got.map((i) => i.id),
            ['draft.hlr', 'suggest.traces', 'gap.fix'],
        );
    });

    it('intentsForActions drops unknown ids', () => {
        const got = intentsForActions(['draft.hlr', 'made-up.intent']);
        assert.deepEqual(got.map((i) => i.id), ['draft.hlr']);
    });

    it('intentsForActions returns [] on empty input', () => {
        assert.deepEqual(intentsForActions([]), []);
    });
});
