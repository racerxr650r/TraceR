// Phase 5b — tier-1 unit tests for the AI Quick Fix target parser.
import { strict as assert } from 'assert';
import { parseBrokenTraceTarget } from '../../src/ai/quickFix';

describe('ai/quickFix.parseBrokenTraceTarget', () => {
    it('extracts an HLR id from a lint message', () => {
        const got = parseBrokenTraceTarget(
            "HLR-001 trace ref 'BAD' is unknown",
        );
        assert.deepEqual(got, { type: 'Hlr', id: 'HLR-001' });
    });

    it('extracts an LLR id from a lint message', () => {
        const got = parseBrokenTraceTarget(
            "LLR-FOO-01 trace ref 'BAD' is unknown",
        );
        assert.deepEqual(got, { type: 'Llr', id: 'LLR-FOO-01' });
    });

    it('upper-cases ids that arrive in mixed case', () => {
        const got = parseBrokenTraceTarget("hlr-042 has a bad ref");
        assert.deepEqual(got, { type: 'Hlr', id: 'HLR-042' });
    });

    it('returns undefined when no id matches', () => {
        assert.equal(
            parseBrokenTraceTarget('something unrelated'),
            undefined,
        );
    });
});
