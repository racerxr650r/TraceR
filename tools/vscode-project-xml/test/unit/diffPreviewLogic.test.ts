import { strict as assert } from 'assert';
import { renderPreviewBody, summarizeOperation, DiffPreviewData } from '../../src/ai/diffPreviewLogic';
import { AiRequestResult } from '../../src/sidecar';

function result(overrides: Partial<AiRequestResult>): AiRequestResult {
    return { kind: 'validated', intent: 'test', target: { tag: 'hlr', id: 'X' }, retries: 0, patch: [], failures: [], ...overrides } as AiRequestResult;
}

describe('diffPreviewLogic', () => {
    describe('renderPreviewBody', () => {
        it('renders a minimal preview with kind and no patch', () => {
            const data: DiffPreviewData = {
                intent: 'draft.hlr',
                label: 'HLR-001',
                result: result({}),
            };
            const body = renderPreviewBody(data);
            assert.ok(body.includes('# Project Spec AI — draft.hlr'));
            assert.ok(body.includes('**Status:** validated'));
            assert.ok(body.includes('_No patch operations._'));
        });

        it('includes summary when provided', () => {
            const data: DiffPreviewData = {
                intent: 'review.item',
                label: 'x',
                result: result({}),
                summary: 'Reviewing HLR-001',
            };
            const body = renderPreviewBody(data);
            assert.ok(body.includes('Reviewing HLR-001'));
        });

        it('renders lint findings when present', () => {
            const data: DiffPreviewData = {
                intent: 'gap.fix',
                label: 'y',
                result: result({
                    lint: {
                        ok: true,
                        errors: [], warnings: [], notes: [],
                        items: [
                            { severity: 'error', message: 'bad ref', code: 'broken-trace' },
                            { severity: 'warning', message: 'no test', code: null },
                        ],
                    },
                }),
            };
            const body = renderPreviewBody(data);
            assert.ok(body.includes('**Lint:** 1 error(s), 1 warning(s).'));
            assert.ok(body.includes('`broken-trace`'));
            assert.ok(body.includes('bad ref'));
        });

        it('renders patch operations as JSON', () => {
            const data: DiffPreviewData = {
                intent: 'draft.llr',
                label: 'z',
                result: result({ patch: [{ op: 'add', path: '/hlrs/hlr/-', value: {} }] }),
            };
            const body = renderPreviewBody(data);
            assert.ok(body.includes('## Proposed patch'));
            assert.ok(body.includes('"op": "add"'));
        });

        it('renders failures section', () => {
            const data: DiffPreviewData = {
                intent: 'expand.hlr_to_llrs',
                label: 'f',
                result: result({ kind: 'rejected', failures: ['schema error'] }),
            };
            const body = renderPreviewBody(data);
            assert.ok(body.includes('## Failures'));
            assert.ok(body.includes('schema error'));
        });

        it('renders advisory findings', () => {
            const data: DiffPreviewData = {
                intent: 'suggest.traces',
                label: 'a',
                result: result({ advisory: [{ note: 'consider adding' }] }),
            };
            const body = renderPreviewBody(data);
            assert.ok(body.includes('## Advisory findings'));
        });
    });

    describe('summarizeOperation', () => {
        it('formats an operation as a bullet', () => {
            assert.equal(
                summarizeOperation({ op: 'add', path: '/hlrs/hlr/-', value: {} }),
                '- add `/hlrs/hlr/-`',
            );
        });

        it('handles replace operations', () => {
            assert.equal(
                summarizeOperation({ op: 'replace', path: '/hlrs/hlr[id=HLR-001]/@name', value: 'x' }),
                '- replace `/hlrs/hlr[id=HLR-001]/@name`',
            );
        });
    });
});
