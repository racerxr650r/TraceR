// Phase 2.5c — pure-logic tests for the Quick Fix helpers in
// src/codeActions/fixes.ts. These do not touch VS Code APIs.

import { strict as assert } from 'assert';
import {
    extractLlrPrefix,
    firstQuoted,
    isFixableCode,
    nextFreeHlrId,
    nextFreeLlrId,
    parseBrokenTrace,
    parseIdFormat,
    parseMissingTemplate,
    parseNoTest,
    QUICK_FIX_CODES,
    stubTestFragment,
    templateStubContent,
} from '../../src/codeActions/fixes';

describe('fixes — Finding.code recognition', () => {
    it('lists exactly the four Phase 2.5c codes', () => {
        assert.deepEqual(
            [...QUICK_FIX_CODES].sort(),
            ['broken-trace', 'id-format', 'missing-template', 'no-test'],
        );
    });

    it('isFixableCode accepts the four codes and rejects others', () => {
        for (const c of QUICK_FIX_CODES) {
            assert.equal(isFixableCode(c), true, `${c} should be fixable`);
        }
        assert.equal(isFixableCode(''), false);
        assert.equal(isFixableCode('foo'), false);
        assert.equal(isFixableCode(undefined), false);
        assert.equal(isFixableCode(123), false);
    });
});

describe('fixes — message parsers', () => {
    it('parses broken-trace HLR messages', () => {
        const info = parseBrokenTrace(
            "HLR HLR-001: <trace> references unknown HLR 'HLR-999'",
        );
        assert.deepEqual(info, { target: 'HLR', badRef: 'HLR-999' });
    });

    it('parses broken-trace LLR messages', () => {
        const info = parseBrokenTrace(
            "test foo: <trace> references unknown LLR 'LLR-XYZ-99'",
        );
        assert.deepEqual(info, { target: 'LLR', badRef: 'LLR-XYZ-99' });
    });

    it('returns undefined for unrelated messages', () => {
        assert.equal(parseBrokenTrace('totally unrelated'), undefined);
    });

    it('parses id-format messages for HLRs', () => {
        const info = parseIdFormat('<hlr id="HLR-1"> does not match HLR-NNN');
        assert.deepEqual(info, { kind: 'HLR', badId: 'HLR-1', prefix: undefined });
    });

    it('parses id-format messages for LLRs and extracts the prefix', () => {
        const info = parseIdFormat('<llr id="LLR-PCL-1"> does not match LLR-XXX-NN');
        assert.deepEqual(info, { kind: 'LLR', badId: 'LLR-PCL-1', prefix: 'PCL' });
    });

    it('parses duplicate-id messages too', () => {
        assert.deepEqual(parseIdFormat('duplicate HLR id: HLR-001'), {
            kind: 'HLR',
            badId: 'HLR-001',
            prefix: undefined,
        });
        assert.deepEqual(parseIdFormat('duplicate LLR id: LLR-PCL-01'), {
            kind: 'LLR',
            badId: 'LLR-PCL-01',
            prefix: 'PCL',
        });
    });

    it('falls back to GEN prefix when LLR id is unrecognisable', () => {
        assert.equal(extractLlrPrefix('LLR-'), 'GEN');
        assert.equal(extractLlrPrefix('garbage'), 'GEN');
    });

    it('parses missing-template messages', () => {
        const msg = '<metadata><document id="Plan"> references missing template `tools/templates/Plan.md.j2` (render_doc.py will fail to render this document)';
        const info = parseMissingTemplate(msg);
        assert.deepEqual(info, {
            docId: 'Plan',
            templatePath: 'tools/templates/Plan.md.j2',
        });
    });

    it('parses no-test messages for HLRs and LLRs', () => {
        assert.deepEqual(parseNoTest('HLR HLR-007 has no test verifying it (directly or via any LLR)'), {
            target: 'HLR',
            targetId: 'HLR-007',
        });
        assert.deepEqual(parseNoTest('LLR LLR-PCL-01 has no test verifying it'), {
            target: 'LLR',
            targetId: 'LLR-PCL-01',
        });
    });

    it('firstQuoted handles single and double quotes', () => {
        assert.equal(firstQuoted("foo 'bar' baz"), 'bar');
        assert.equal(firstQuoted('foo "bar" baz'), 'bar');
        assert.equal(firstQuoted('no quotes'), undefined);
    });
});

describe('fixes — id allocation', () => {
    it('next free HLR id picks max+1 with preserved width', () => {
        assert.equal(nextFreeHlrId([]), 'HLR-001');
        assert.equal(nextFreeHlrId(['HLR-001', 'HLR-007', 'HLR-003']), 'HLR-008');
        assert.equal(nextFreeHlrId(['HLR-9999']), 'HLR-10000');
    });

    it('next free LLR id keeps the requested prefix', () => {
        assert.equal(nextFreeLlrId('PCL', []), 'LLR-PCL-01');
        assert.equal(
            nextFreeLlrId('PCL', ['LLR-PCL-01', 'LLR-PCL-04', 'LLR-OTHER-99']),
            'LLR-PCL-05',
        );
    });

    it('next free id preserves zero-padding width', () => {
        assert.equal(nextFreeLlrId('AAA', ['LLR-AAA-099']), 'LLR-AAA-100');
    });
});

describe('fixes — stub builders', () => {
    it('templateStubContent mentions the doc id', () => {
        const s = templateStubContent('Plan');
        assert.match(s, /Plan/);
    });

    it('stubTestFragment cites the orphan via a payload-agnostic <trace>', () => {
        const s = stubTestFragment({ target: 'HLR', targetId: 'HLR-007' });
        assert.match(s, /<file path="test\/test_hlr_stubs\.py"/);
        assert.match(s, /<trace target="HLR" ref="HLR-007"\/>/);
    });

    it('stubTestFragment builds a unique stub name per target id', () => {
        const a = stubTestFragment({ target: 'LLR', targetId: 'LLR-PCL-01' });
        const b = stubTestFragment({ target: 'LLR', targetId: 'LLR-PCL-02' });
        assert.notEqual(a, b);
    });
});
