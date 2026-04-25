import * as assert from 'assert';
import * as path from 'path';
import {
    findBaselineDocument,
    invalidateDocumentsCache,
    loadDocuments,
    sourcePath,
    templatePath,
} from '../../src/util/documents';
import {
    DocumentInfo,
    ListDocumentsResult,
    ProjectIoClient,
} from '../../src/sidecar';

// Five baseline documents emitted by the schema-driven sidecar
// (ordered the same way Project.xml lists them in <metadata>).
const BASELINE_DOCS: DocumentInfo[] = [
    {
        id: 'SDD',
        title: 'Software Design Document',
        source: 'doc/SDD.md',
        version: '0.1', date: '2026-04-25', author: 'TraceR Tests',
        template: 'tools/templates/SDD.md.j2',
        output: 'doc/SDD.md',
    },
    {
        id: 'HLRs',
        title: 'High-Level Requirements',
        source: 'doc/HLRs.md',
        version: '0.1', date: '2026-04-25', author: 'TraceR Tests',
        template: 'tools/templates/HLRs.md.j2',
        output: 'doc/HLRs.md',
    },
    {
        id: 'LLRs',
        title: 'Low-Level Requirements',
        source: 'doc/LLRs.md',
        version: '0.1', date: '2026-04-25', author: 'TraceR Tests',
        template: 'tools/templates/LLRs.md.j2',
        output: 'doc/LLRs.md',
    },
    {
        id: 'STP',
        title: 'Software Test Plan',
        source: 'doc/STP.md',
        version: '0.1', date: '2026-04-25', author: 'TraceR Tests',
        template: 'tools/templates/STP.md.j2',
        output: 'doc/STP.md',
    },
    {
        id: 'Traceability',
        title: 'Traceability Matrix',
        source: 'doc/Traceability.md',
        version: '0.1', date: '2026-04-25', author: 'TraceR Tests',
        template: 'tools/templates/Traceability.md.j2',
        output: 'doc/Traceability.md',
    },
];

const PLAN_DOC: DocumentInfo = {
    id: 'Plan',
    title: 'Project Plan',
    source: 'doc/Plan.md',
    version: '0.1', date: '2026-04-25', author: 'TraceR Tests',
    template: 'tools/templates/Plan.md.j2',
    output: 'doc/Plan.md',
};

class FakeClient {
    public callCount = 0;
    constructor(private readonly result: DocumentInfo[]) {}
    async listDocuments(): Promise<ListDocumentsResult> {
        this.callCount += 1;
        return { documents: this.result.slice() };
    }
}

function asClient(c: FakeClient): ProjectIoClient {
    return c as unknown as ProjectIoClient;
}

describe('util/documents', () => {
    describe('loadDocuments', () => {
        it('returns the document list from the sidecar verbatim', async () => {
            // LLR-BLD-01 (Phase 2.5): the document set is sourced from
            // the sidecar's list_documents method, not a hard-coded
            // constant.
            const client = new FakeClient(BASELINE_DOCS);
            const docs = await loadDocuments(asClient(client));
            assert.deepStrictEqual(
                docs.map((d) => d.id),
                ['SDD', 'HLRs', 'LLRs', 'STP', 'Traceability'],
            );
        });

        it('caches the result per client and reuses it', async () => {
            const client = new FakeClient(BASELINE_DOCS);
            const a = await loadDocuments(asClient(client));
            const b = await loadDocuments(asClient(client));
            assert.strictEqual(a, b, 'cache should return same array');
            assert.strictEqual(client.callCount, 1, 'sidecar called once');
        });

        it('invalidateDocumentsCache forces a re-fetch', async () => {
            const client = new FakeClient(BASELINE_DOCS);
            await loadDocuments(asClient(client));
            invalidateDocumentsCache(asClient(client));
            await loadDocuments(asClient(client));
            assert.strictEqual(client.callCount, 2);
        });

        it('picks up a new schema-driven document with no source edit', async () => {
            // Success metric pin (PVD §8 "Schema-driven extensibility"):
            // adding a Plan entry is purely a Project.xml + template
            // change; loadDocuments returns it without any TS edit.
            const client = new FakeClient([...BASELINE_DOCS, PLAN_DOC]);
            const docs = await loadDocuments(asClient(client));
            assert.strictEqual(docs.length, 6);
            const plan = findBaselineDocument(docs, 'Plan');
            assert.ok(plan, 'Plan should be discovered via list_documents');
            assert.strictEqual(plan!.template, 'tools/templates/Plan.md.j2');
            assert.strictEqual(plan!.output, 'doc/Plan.md');
        });
    });

    describe('findBaselineDocument', () => {
        it('returns the entry with a matching id', () => {
            const doc = findBaselineDocument(BASELINE_DOCS, 'STP');
            assert.ok(doc, 'STP should be findable');
            assert.strictEqual(doc!.template, 'tools/templates/STP.md.j2');
            assert.strictEqual(doc!.output, 'doc/STP.md');
        });

        it('returns undefined for an unknown id', () => {
            assert.strictEqual(
                findBaselineDocument(BASELINE_DOCS, 'NoSuchDoc'),
                undefined,
            );
        });
    });

    describe('templatePath / sourcePath', () => {
        it('templatePath joins workspaceRoot with the doc-relative template', () => {
            const doc = BASELINE_DOCS[0]; // SDD
            assert.strictEqual(
                templatePath('/repo', doc),
                path.join('/repo', 'tools/templates/SDD.md.j2'),
            );
        });

        it('sourcePath joins workspaceRoot with the doc-relative output', () => {
            const doc = BASELINE_DOCS[1]; // HLRs
            assert.strictEqual(
                sourcePath('/repo', doc),
                path.join('/repo', 'doc/HLRs.md'),
            );
        });

        it('templatePath returns absolute paths verbatim', () => {
            const doc: DocumentInfo = {
                ...BASELINE_DOCS[0],
                template: '/abs/path/SDD.md.j2',
            };
            assert.strictEqual(templatePath('/repo', doc), '/abs/path/SDD.md.j2');
        });

        it('sourcePath returns absolute output paths verbatim', () => {
            const doc: DocumentInfo = {
                ...BASELINE_DOCS[0],
                output: '/abs/path/SDD.md',
            };
            assert.strictEqual(sourcePath('/repo', doc), '/abs/path/SDD.md');
        });
    });
});
