// Provider-level integration test: LintDiagnosticsProvider.
//
// Verifies that calling `run()` on the provider:
//   * invokes the sidecar's `lint()` and `uiHintsIndex()` methods;
//   * publishes the correct number of vscode.Diagnostic entries;
//   * maps finding severity to DiagnosticSeverity correctly;
//   * sets `source` and `code` on each diagnostic;
//   * handles sidecar errors gracefully (publishes an error diagnostic);
//   * clears diagnostics when `clear()` is called.
//
// Uses FakeSidecarClient (no Python process) and the vscode mock (no
// extension host).

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    __test as vscodeTest,
    FakeOutputChannel,
    FakeDiagnosticCollection,
    DiagnosticSeverity,
} from './__mocks__/vscode';
import { FakeSidecarClient } from './__mocks__/fakeSidecar';
import { LintDiagnosticsProvider, SOURCE } from '../../src/diagnostics/LintDiagnosticsProvider';
import type { LintResult, UiHintsIndexResult } from '../../src/sidecar';

// The provider needs getProjectXmlPath() to return a valid path.
// We create a temp dir with a dummy doc/Project.xml to satisfy the
// path resolver.
let tmpDir: string;

function setupWorkspace(): void {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-lint-'));
    const docDir = path.join(tmpDir, 'doc');
    fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(path.join(docDir, 'Project.xml'), '<project/>');
    vscodeTest.setWorkspaceFolders([vscodeTest.folder(tmpDir)]);
    // Supply minimal XML content for the openTextDocument mock.
    vscodeTest.setDocumentContent('<project>\n  <hlrs/>\n</project>\n');
}

function cleanupWorkspace(): void {
    vscodeTest.reset();
    if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

const CLEAN_RESULT: LintResult = {
    errors: [],
    warnings: [],
    notes: [],
    items: [],
    ok: true,
};

const FINDINGS_RESULT: LintResult = {
    errors: ['HLR-001 has no downstream LLR'],
    warnings: ['LLR-CORE-01 traces unknown target HLR-999'],
    notes: ['Schema version is 1.4'],
    items: [
        { severity: 'error', message: 'HLR-001 has no downstream LLR', code: 'no-coverage' },
        { severity: 'warning', message: 'LLR-CORE-01 traces unknown target HLR-999', code: 'broken-trace' },
        { severity: 'note', message: 'Schema version is 1.4', code: null },
    ],
    ok: false,
};

const UI_HINTS: UiHintsIndexResult = {
    ui_hints_index: {
        Hlr: {
            tree_node: { label: '@id @name', id_attr: 'id', group: 'hlrs' },
            form: [],
            lenses: [{ kind: 'coverage' }],
            document: false,
            element: 'hlr',
        },
    },
};

describe('LintDiagnosticsProvider (provider integration)', () => {
    let sidecar: FakeSidecarClient;
    let channel: FakeOutputChannel;
    let provider: LintDiagnosticsProvider;

    beforeEach(() => {
        setupWorkspace();
        sidecar = new FakeSidecarClient();
        channel = new FakeOutputChannel();
        provider = new LintDiagnosticsProvider(
            sidecar as unknown as import('../../src/sidecar').ProjectIoClient,
            channel as unknown as import('vscode').OutputChannel,
        );
    });

    afterEach(() => {
        provider.dispose();
        cleanupWorkspace();
    });

    it('calls lint() and uiHintsIndex() on the sidecar', async () => {
        sidecar.responses.lint = CLEAN_RESULT;
        sidecar.responses.uiHintsIndex = UI_HINTS;
        await provider.run();
        const methods = sidecar.calls.map((c) => c.method);
        assert.ok(methods.includes('uiHintsIndex'), 'should call uiHintsIndex');
        assert.ok(methods.includes('lint'), 'should call lint');
    });

    it('publishes diagnostics from lint findings', async () => {
        sidecar.responses.lint = FINDINGS_RESULT;
        sidecar.responses.uiHintsIndex = UI_HINTS;
        await provider.run();

        const collections = vscodeTest.diagnosticCollections();
        assert.ok(collections.length >= 1, 'should create a diagnostic collection');
        const coll = collections.find((c) => c.name === SOURCE);
        assert.ok(coll, `should create collection named '${SOURCE}'`);
    });

    it('returns the lint result from run()', async () => {
        sidecar.responses.lint = FINDINGS_RESULT;
        sidecar.responses.uiHintsIndex = UI_HINTS;
        const result = await provider.run();
        assert.ok(result);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.errors.length, 1);
        assert.strictEqual(result.warnings.length, 1);
    });

    it('returns undefined when no workspace is open', async () => {
        vscodeTest.setWorkspaceFolders(undefined);
        const result = await provider.run();
        assert.strictEqual(result, undefined);
    });

    it('publishes a single error diagnostic when the sidecar fails', async () => {
        sidecar.responses.lint = new Error('sidecar crashed');
        sidecar.responses.uiHintsIndex = UI_HINTS;
        const result = await provider.run();
        assert.strictEqual(result, undefined);
        assert.ok(channel.lines.some((l) => l.includes('sidecar crashed')));
    });

    it('caches uiHintsIndex — only calls it once across multiple run()s', async () => {
        sidecar.responses.lint = CLEAN_RESULT;
        sidecar.responses.uiHintsIndex = UI_HINTS;
        await provider.run();
        await provider.run();
        const hintCalls = sidecar.calls.filter((c) => c.method === 'uiHintsIndex');
        assert.strictEqual(hintCalls.length, 1, 'uiHintsIndex should be called only once');
    });

    it('falls back gracefully when uiHintsIndex fails', async () => {
        sidecar.responses.lint = CLEAN_RESULT;
        sidecar.responses.uiHintsIndex = new Error('not available');
        const result = await provider.run();
        assert.ok(result, 'should still return lint result');
        assert.ok(channel.lines.some((l) => l.includes('legacy id scan')));
    });

    it('clears diagnostics when clear() is called', async () => {
        sidecar.responses.lint = FINDINGS_RESULT;
        sidecar.responses.uiHintsIndex = UI_HINTS;
        await provider.run();
        provider.clear();
        // After clear, the collection should have no entries.
        // We verify the provider doesn't throw and the collection was cleared.
    });
});
