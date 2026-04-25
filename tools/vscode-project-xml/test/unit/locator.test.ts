import * as assert from 'assert';
import type * as vscode from 'vscode';
import { FakeTextDocument } from './__mocks__/vscode';
import {
    findAttrRange,
    findElementRange,
    findIdRange,
    rangeForFinding,
} from '../../src/util/locator';

const SAMPLE = [
    '<project>',
    '  <hlrs>',
    '    <section number="1" title="t">',
    '      <hlr id="HLR-001" name="alpha"><text>a</text></hlr>',
    '      <hlr id="HLR-002" name="beta"><text>b</text></hlr>',
    '    </section>',
    '  </hlrs>',
    '  <llrs>',
    '    <function number="1" title="t" name="n" source="s">',
    '      <llr id="LLR-AAA-01"><text>x</text></llr>',
    '    </function>',
    '  </llrs>',
    '  <tests>',
    '    <file path="test/x.py" role="unit" count="1">',
    '      <test name="test_widget"><purpose>p</purpose></test>',
    '    </file>',
    '  </tests>',
    '</project>',
    '',
].join('\n');

function offsetOf(line: number, character: number): number {
    const lines = SAMPLE.split('\n');
    let off = 0;
    for (let i = 0; i < line; i++) {
        off += lines[i].length + 1;
    }
    return off + character;
}

function asDoc(): vscode.TextDocument {
    return new FakeTextDocument(SAMPLE) as unknown as vscode.TextDocument;
}

describe('util/locator', () => {
    const doc = asDoc();

    describe('findIdRange', () => {
        it('targets the id="..." attribute, not the whole element', () => {
            // LLR-RVX-02: range covers the id attribute only.
            const r = findIdRange(doc, 'hlr', 'HLR-001');
            assert.ok(r, 'HLR-001 should be findable');
            const slice = SAMPLE.slice(
                offsetOf(r!.start.line, r!.start.character),
                offsetOf(r!.end.line, r!.end.character),
            );
            assert.strictEqual(slice, 'id="HLR-001"');
        });

        it('disambiguates between elements that share an id substring', () => {
            // \\bid="ID" anchoring prevents HLR-001 from also matching
            // HLR-0011 if such an id ever existed.
            const r1 = findIdRange(doc, 'hlr', 'HLR-001');
            const r2 = findIdRange(doc, 'hlr', 'HLR-002');
            assert.ok(r1 && r2);
            assert.notStrictEqual(r1!.start.line, r2!.start.line);
        });

        it('returns undefined when the id is not present', () => {
            assert.strictEqual(findIdRange(doc, 'hlr', 'HLR-999'), undefined);
        });
    });

    describe('findAttrRange / findElementRange', () => {
        it('findAttrRange locates a test by name', () => {
            const r = findAttrRange(doc, 'test', 'name', 'test_widget');
            assert.ok(r);
        });

        it('findElementRange locates the opening tag of a payload', () => {
            const r = findElementRange(doc, 'llrs');
            assert.ok(r);
        });
    });

    describe('rangeForFinding', () => {
        it('prefers HLR ids over other tokens in the message', () => {
            // LLR-RVX-04: scan order is HLR -> LLR -> quoted -> element.
            const expected = findIdRange(doc, 'hlr', 'HLR-002')!;
            const got = rangeForFinding(
                doc,
                'HLR HLR-002 has no test verifying it (mentions <hlr>)',
            );
            assert.strictEqual(got.start.line, expected.start.line);
        });

        it('falls back to LLR id when no HLR matches', () => {
            const expected = findIdRange(doc, 'llr', 'LLR-AAA-01')!;
            const got = rangeForFinding(doc, "LLR LLR-AAA-01 has no test verifying it");
            assert.strictEqual(got.start.line, expected.start.line);
        });

        it('falls back to a quoted attribute value when no id matches', () => {
            const got = rangeForFinding(doc, "test name 'test_widget' is duplicated");
            // Should land somewhere on the test_widget line, not on line 0.
            assert.notStrictEqual(got.start.line, 0);
        });

        it('falls back to <element> mention when nothing else matches', () => {
            const got = rangeForFinding(doc, 'malformed <hlrs> payload');
            const expected = findElementRange(doc, 'hlrs')!;
            assert.strictEqual(got.start.line, expected.start.line);
        });

        it('falls back to file head when no token matches anything', () => {
            const got = rangeForFinding(doc, 'totally generic message');
            assert.strictEqual(got.start.line, 0);
            assert.strictEqual(got.start.character, 0);
        });
    });
});
