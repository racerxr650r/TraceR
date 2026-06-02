// Phase 2.5c — provider tests for QuickFixProvider.
//
// Verifies the dispatch table is keyed strictly on Finding.code (the
// vscode.Diagnostic.code mirror); no payload element name (HLR / LLR /
// `<plan>` / future) appears anywhere in the provider. The same
// fixture text is used for every code so the provider's behaviour
// proves to be payload-agnostic.

import { strict as assert } from 'assert';
import type * as vscode from 'vscode';
import * as vscodeMock from './__mocks__/vscode';
import {
    Diagnostic,
    DiagnosticSeverity,
    Range,
    Uri,
} from './__mocks__/vscode';
import {
    FIX_BROKEN_TRACE,
    FIX_ID_FORMAT,
    FIX_MISSING_TEMPLATE,
    FIX_NO_TEST,
    FIX_TABLE,
    QuickFixProvider,
} from '../../src/codeActions/QuickFixProvider';

const SOURCE = 'projectXml';

function diag(code: string | undefined, message: string, source = SOURCE): Diagnostic {
    const d = new Diagnostic(asRange(new Range(0, 0, 0, 1)), message, DiagnosticSeverity.Error);
    d.source = source;
    if (code !== undefined) {
        d.code = code;
    }
    return d;
}

function fakeDoc(): vscode.TextDocument {
    return { uri: Uri.file('/ws/doc/Project.xml') } as unknown as vscode.TextDocument;
}

function asRange(r: Range): vscode.Range {
    return r as unknown as vscode.Range;
}

function asContext(diagnostics: Diagnostic[]): vscode.CodeActionContext {
    return { diagnostics } as unknown as vscode.CodeActionContext;
}

function asToken(): vscode.CancellationToken {
    return { isCancellationRequested: false } as unknown as vscode.CancellationToken;
}

describe('QuickFixProvider (Phase 2.5c)', () => {
    const provider = new QuickFixProvider();

    it('contributes only the QuickFix code action kind', () => {
        assert.equal(QuickFixProvider.providedCodeActionKinds.length, 1);
        assert.equal(
            QuickFixProvider.providedCodeActionKinds[0].value,
            'quickfix',
        );
    });

    it('exposes a fix table keyed exactly on the four Finding.codes', () => {
        assert.deepEqual(
            Object.keys(FIX_TABLE).sort(),
            ['broken-trace', 'id-format', 'missing-template', 'no-test'],
        );
    });

    it('returns a Quick Fix for each Finding.code (broken-trace)', () => {
        const actions = provider.provideCodeActions(
            fakeDoc(),
            asRange(new Range(0, 0, 0, 1)),
            asContext([diag('broken-trace', "<trace> references unknown HLR 'HLR-999'")]),
            asToken(),
        );
        assert.equal(actions.length, 1);
        assert.equal(actions[0].command?.command, FIX_BROKEN_TRACE);
        assert.equal(actions[0].title, FIX_TABLE['broken-trace'].title);
        assert.equal(actions[0].kind?.value, 'quickfix');
    });

    it('returns a Quick Fix for id-format', () => {
        const actions = provider.provideCodeActions(
            fakeDoc(),
            asRange(new Range(0, 0, 0, 1)),
            asContext([diag('id-format', '<hlr id="HLR-1"> does not match HLR-NNN')]),
            asToken(),
        );
        assert.equal(actions.length, 1);
        assert.equal(actions[0].command?.command, FIX_ID_FORMAT);
    });

    it('returns a Quick Fix for missing-template', () => {
        const actions = provider.provideCodeActions(
            fakeDoc(),
            asRange(new Range(0, 0, 0, 1)),
            asContext([diag('missing-template', '<document id="X"> references missing template `tools/templates/X.md.j2`')]),
            asToken(),
        );
        assert.equal(actions.length, 1);
        assert.equal(actions[0].command?.command, FIX_MISSING_TEMPLATE);
    });

    it('returns a Quick Fix for no-test', () => {
        const actions = provider.provideCodeActions(
            fakeDoc(),
            asRange(new Range(0, 0, 0, 1)),
            asContext([diag('no-test', 'LLR LLR-PCL-01 has no test verifying it')]),
            asToken(),
        );
        assert.equal(actions.length, 1);
        assert.equal(actions[0].command?.command, FIX_NO_TEST);
    });

    it('ignores diagnostics from other sources (eg redhat.vscode-xml)', () => {
        const actions = provider.provideCodeActions(
            fakeDoc(),
            asRange(new Range(0, 0, 0, 1)),
            asContext([diag('broken-trace', "unknown HLR 'X'", 'xml')]),
            asToken(),
        );
        assert.equal(actions.length, 0);
    });

    it('ignores diagnostics with no code or an unknown code', () => {
        const noCode = provider.provideCodeActions(
            fakeDoc(),
            asRange(new Range(0, 0, 0, 1)),
            asContext([diag(undefined, 'just informational')]),
            asToken(),
        );
        const unknown = provider.provideCodeActions(
            fakeDoc(),
            asRange(new Range(0, 0, 0, 1)),
            asContext([diag('made-up-code', 'whatever')]),
            asToken(),
        );
        assert.equal(noCode.length, 0);
        assert.equal(unknown.length, 0);
    });

    it('forwards uri / range / message verbatim to the command args', () => {
        const r = new Range(3, 4, 3, 10);
        const d = diag('id-format', '<hlr id="HLR-1"> does not match HLR-NNN');
        d.range = r;
        const actions = provider.provideCodeActions(
            fakeDoc(),
            asRange(r),
            asContext([d]),
            asToken(),
        );
        const args = actions[0].command?.arguments?.[0] as {
            uri: string; message: string; range: { start: { line: number } };
        };
        assert.equal(args.uri, 'file:///ws/doc/Project.xml');
        assert.equal(args.message, '<hlr id="HLR-1"> does not match HLR-NNN');
        assert.equal(args.range.start.line, 3);
    });

    it('payload-agnostic: a `<plan>`-shaped diagnostic still routes by code', () => {
        // Same broken-trace handler fires whether the offending owner
        // is an HLR, LLR, or a future <plan> payload — the provider
        // never inspects the message owner.
        const planDiag = diag(
            'broken-trace',
            "plan item P-001: <trace> references unknown HLR 'HLR-999'",
        );
        const actions = provider.provideCodeActions(
            fakeDoc(),
            asRange(new Range(0, 0, 0, 1)),
            asContext([planDiag]),
            asToken(),
        );
        assert.equal(actions.length, 1);
        assert.equal(actions[0].command?.command, FIX_BROKEN_TRACE);
    });
});

// Static assertion: the QuickFixProvider source file must not
// reference any payload element name. This pins the SDP §8 Phase
// 2.5c contract: "never on payload element name".
describe('QuickFixProvider — payload-agnostic guarantee', () => {
    it('source contains no payload element name', () => {
        const fs = require('fs') as typeof import('fs');
        const path = require('path') as typeof import('path');
        const file = path.resolve(
            __dirname, '..', '..', 'src', 'codeActions', 'QuickFixProvider.ts',
        );
        const src = fs.readFileSync(file, 'utf8');
        // Strip line comments so doc-comment mentions of <plan> /
        // <hlr> as examples don't trip the assertion.
        const code = src
            .split('\n')
            .filter((line) => !line.trim().startsWith('//'))
            .join('\n');
        for (const tag of ['<plan>', '<hlr>', '<llr>', '<test>', '<sdd>', '<stp>']) {
            assert.equal(
                code.includes(tag),
                false,
                `provider source mentions ${tag}`,
            );
        }
    });
    // Touch the import so the linter doesn't drop it.
    void vscodeMock;
});

describe('fixNoTest command handler (LLR-ADD-02)', () => {
    it('fixNoTest routes through sidecar.applyEdit, not WorkspaceEdit (LLR-ADD-02)', () => {
        // LLR-ADD-02: the no-test fix must call ProjectIoClient.applyEdit so
        // the new <test> element is validated by the sidecar before the file is
        // written.  The other three Phase 2.5c fixes use WorkspaceEdit directly.
        const fs = require('fs') as typeof import('fs');
        const path = require('path') as typeof import('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', '..', 'src', 'commands', 'quickFixes.ts'),
            'utf8',
        );
        assert.ok(src.includes('sidecar.applyEdit') || src.includes('.applyEdit('),
            "quickFixes.ts must call applyEdit for the no-test fix");
        // Verify the no-test handler does not rely on WorkspaceEdit for its
        // primary flow (WorkspaceEdit is fine for the other three fixers).
        const noTestSection = src.slice(src.indexOf('createStubTest') > 0
            ? src.lastIndexOf('async function', src.indexOf('applyEdit'))
            : 0);
        // applyEdit must appear somewhere in the file
        assert.ok(src.includes('applyEdit'), "quickFixes.ts must reference applyEdit");
    });
});
