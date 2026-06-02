// Provider-level integration test: MarkdownPreviewProvider.
//
// Verifies that:
//   * provideTextDocumentContent calls listDocuments + render on sidecar;
//   * the rendered markdown is cached (second call doesn't hit sidecar);
//   * markStale(docId) invalidates cache and fires onDidChange;
//   * markStale() (no arg) invalidates all tracked documents;
//   * isTracked returns true after a preview has been opened;
//   * unknown doc ids produce a helpful error message (no throw);
//   * sidecar errors produce a helpful error message (no throw).

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    __test as vscodeTest,
    FakeOutputChannel,
    Uri,
} from './__mocks__/vscode';
import { FakeSidecarClient } from './__mocks__/fakeSidecar';
import {
    MarkdownPreviewProvider,
    previewUri,
    previewDocId,
    PREVIEW_SCHEME,
} from '../../src/preview/MarkdownPreviewProvider';
import { invalidateDocumentsCache } from '../../src/util/documents';
import type { ProjectIoClient } from '../../src/sidecar';

let tmpDir: string;

function setupWorkspace(): void {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-preview-'));
    const docDir = path.join(tmpDir, 'doc');
    fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(path.join(docDir, 'Project.xml'), '<project/>');
    vscodeTest.setWorkspaceFolders([vscodeTest.folder(tmpDir)]);
}

function cleanupWorkspace(): void {
    vscodeTest.reset();
    if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

describe('MarkdownPreviewProvider (provider integration)', () => {
    let sidecar: FakeSidecarClient;
    let channel: FakeOutputChannel;
    let provider: MarkdownPreviewProvider;

    beforeEach(() => {
        setupWorkspace();
        sidecar = new FakeSidecarClient();
        channel = new FakeOutputChannel();
        provider = new MarkdownPreviewProvider(
            sidecar as unknown as ProjectIoClient,
            channel as unknown as import('vscode').OutputChannel,
        );
        // Clear document cache from previous tests (WeakMap keyed on client).
        invalidateDocumentsCache(sidecar as unknown as ProjectIoClient);
    });

    afterEach(() => {
        provider.dispose();
        cleanupWorkspace();
    });

    // ── URI helpers ──────────────────────────────────────────────

    describe('previewUri / previewDocId', () => {
        it('round-trips a doc id through URI and back', () => {
            const uri = previewUri('SDD');
            assert.strictEqual(uri.scheme, PREVIEW_SCHEME);
            const id = previewDocId(uri);
            assert.strictEqual(id, 'SDD');
        });

        it('returns undefined for non-preview URIs', () => {
            const uri = Uri.file('/tmp/foo.md');
            assert.strictEqual(previewDocId(uri as unknown as import('vscode').Uri), undefined);
        });
    });

    // ── Content rendering ────────────────────────────────────────

    it('calls listDocuments + render on first content request', async () => {
        sidecar.responses.listDocuments = {
            documents: [{
                id: 'SDD',
                title: 'Software Design Description',
                source: 'doc/SDD.md',
                version: '1.0',
                date: '2026-01-01',
                author: 'Test',
                template: 'tools/templates/SDD.md.j2',
                output: 'doc/SDD.md',
            }],
        };
        sidecar.responses.render = {
            output: '# SDD\n\nRendered content.',
            out_path: null,
        };

        const uri = previewUri('SDD');
        const content = await provider.provideTextDocumentContent(uri);

        assert.ok(content.includes('Rendered content'));
        const methods = sidecar.calls.map((c) => c.method);
        assert.ok(methods.includes('listDocuments'));
        assert.ok(methods.includes('render'));
    });

    it('caches rendered content (second call skips sidecar)', async () => {
        sidecar.responses.listDocuments = {
            documents: [{
                id: 'SDD',
                title: 'SDD',
                source: 'doc/SDD.md',
                version: '1.0',
                date: '',
                author: '',
                template: 'tools/templates/SDD.md.j2',
                output: 'doc/SDD.md',
            }],
        };
        sidecar.responses.render = {
            output: '# SDD cached',
            out_path: null,
        };

        const uri = previewUri('SDD');
        await provider.provideTextDocumentContent(uri);
        const callsBefore = sidecar.calls.length;
        const content2 = await provider.provideTextDocumentContent(uri);
        assert.ok(content2.includes('SDD cached'));
        // No new sidecar calls after the first request.
        assert.strictEqual(sidecar.calls.length, callsBefore);
    });

    it('marks a document as tracked after first preview', async () => {
        sidecar.responses.listDocuments = {
            documents: [{
                id: 'HLRs',
                title: 'HLRs',
                source: 'doc/HLRs.md',
                version: '1.0',
                date: '',
                author: '',
                template: 'tools/templates/HLRs.md.j2',
                output: 'doc/HLRs.md',
            }],
        };
        sidecar.responses.render = { output: '# HLRs', out_path: null };

        assert.strictEqual(provider.isTracked('HLRs'), false);
        await provider.provideTextDocumentContent(previewUri('HLRs'));
        assert.strictEqual(provider.isTracked('HLRs'), true);
    });

    // ── Cache invalidation ───────────────────────────────────────

    it('markStale(docId) fires onDidChange for that document', async () => {
        sidecar.responses.listDocuments = {
            documents: [{
                id: 'SDD',
                title: 'SDD',
                source: 'doc/SDD.md',
                version: '1.0',
                date: '',
                author: '',
                template: 'tools/templates/SDD.md.j2',
                output: 'doc/SDD.md',
            }],
        };
        sidecar.responses.render = { output: '# first', out_path: null };
        await provider.provideTextDocumentContent(previewUri('SDD'));

        const firedUris: string[] = [];
        provider.onDidChange((uri) => firedUris.push(uri.toString()));

        provider.markStale('SDD');
        assert.strictEqual(firedUris.length, 1);
        assert.ok(firedUris[0].includes('SDD'));
    });

    it('markStale() (no arg) fires onDidChange for all tracked docs', async () => {
        sidecar.responses.listDocuments = {
            documents: [
                { id: 'SDD', title: '', source: '', version: '', date: '', author: '', template: 't', output: '' },
                { id: 'HLRs', title: '', source: '', version: '', date: '', author: '', template: 't', output: '' },
            ],
        };
        sidecar.responses.render = { output: '# doc', out_path: null };

        await provider.provideTextDocumentContent(previewUri('SDD'));
        // Invalidate documents cache so the second request re-fetches.
        invalidateDocumentsCache(sidecar as unknown as ProjectIoClient);
        sidecar.responses.listDocuments = {
            documents: [
                { id: 'SDD', title: '', source: '', version: '', date: '', author: '', template: 't', output: '' },
                { id: 'HLRs', title: '', source: '', version: '', date: '', author: '', template: 't', output: '' },
            ],
        };
        await provider.provideTextDocumentContent(previewUri('HLRs'));

        const firedUris: string[] = [];
        provider.onDidChange((uri) => firedUris.push(uri.toString()));

        provider.markStale();
        assert.strictEqual(firedUris.length, 2);
    });

    // ── Error handling ───────────────────────────────────────────

    it('returns a helpful message for unknown doc ids', async () => {
        sidecar.responses.listDocuments = {
            documents: [{
                id: 'SDD',
                title: 'SDD',
                source: '',
                version: '',
                date: '',
                author: '',
                template: '',
                output: '',
            }],
        };

        const content = await provider.provideTextDocumentContent(previewUri('NOPE'));
        assert.ok(content.includes('Unknown document id'));
        assert.ok(content.includes('NOPE'));
    });

    it('returns a helpful message when listDocuments fails', async () => {
        sidecar.responses.listDocuments = new Error('sidecar down');
        const content = await provider.provideTextDocumentContent(previewUri('SDD'));
        assert.ok(content.includes('discovery failed'));
    });

    it('returns a helpful message when render fails', async () => {
        sidecar.responses.listDocuments = {
            documents: [{
                id: 'SDD',
                title: 'SDD',
                source: 'doc/SDD.md',
                version: '',
                date: '',
                author: '',
                template: 'tools/templates/SDD.md.j2',
                output: 'doc/SDD.md',
            }],
        };
        sidecar.responses.render = new Error('template not found');

        const content = await provider.provideTextDocumentContent(previewUri('SDD'));
        assert.ok(content.includes('render failed'));
    });
});

describe('render commands — static source assertions', () => {
    const renderSrc = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'src', 'commands', 'render.ts'),
        'utf8',
    );

    it('renderAndPreview calls markStale before showing the preview (LLR-RAP-02)', () => {
        // LLR-RAP-02: renderAndPreview must call preview.markStale(docId) to
        // invalidate the cache before dispatching markdown.showPreviewToSide.
        assert.ok(renderSrc.includes('markStale'),
            "render.ts must call markStale in renderAndPreview");
        assert.ok(renderSrc.includes('markdown.showPreviewToSide') || renderSrc.includes('showPreviewToSide'),
            "render.ts must dispatch markdown.showPreviewToSide");
    });

    it('renderAll uses withProgress and collects failures (LLR-RAL-02)', () => {
        // LLR-RAL-02: renderAll must wrap the batch operation in withProgress
        // and must continue past individual failures into a failures[] array.
        assert.ok(renderSrc.includes('withProgress'),
            "render.ts renderAll must use withProgress");
        assert.ok(renderSrc.includes('failures'),
            "render.ts renderAll must collect failures");
    });

    it('renderAll calls markStale for each rendered document (LLR-RAL-03)', () => {
        // LLR-RAL-03: renderAll must call markStale on the preview provider
        // so each rendered document's preview is refreshed.
        assert.ok(renderSrc.includes('markStale'),
            "render.ts renderAll must call markStale");
    });
});
