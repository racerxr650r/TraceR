import * as assert from 'assert';
import * as path from 'path';
import {
    BASELINE_DOCUMENTS,
    findBaselineDocument,
    sourcePath,
    templatePath,
} from '../../src/util/documents';

describe('util/documents', () => {
    describe('BASELINE_DOCUMENTS', () => {
        it('lists exactly the five Phase-2 baseline ids in the documented order', () => {
            // LLR-BLD-01: BASELINE_DOCUMENTS is the single source of
            // truth for the Phase-2 hard-coded document set.
            assert.deepStrictEqual(
                BASELINE_DOCUMENTS.map((d) => d.id),
                ['SDD', 'HLRs', 'LLRs', 'STP', 'Traceability'],
            );
        });

        it('every entry names a *.j2 template under tools/templates/', () => {
            for (const doc of BASELINE_DOCUMENTS) {
                assert.ok(
                    doc.template.endsWith('.j2'),
                    `template for ${doc.id} should be a .j2 file: ${doc.template}`,
                );
            }
        });

        it('every entry writes to a doc/*.md path matching its id', () => {
            for (const doc of BASELINE_DOCUMENTS) {
                assert.ok(
                    doc.source.startsWith('doc/') && doc.source.endsWith('.md'),
                    `source for ${doc.id} should be doc/*.md: ${doc.source}`,
                );
            }
        });
    });

    describe('findBaselineDocument', () => {
        it('returns the entry with a matching id', () => {
            const doc = findBaselineDocument('STP');
            assert.ok(doc, 'STP should be findable');
            assert.strictEqual(doc!.template, 'STP.md.j2');
            assert.strictEqual(doc!.source, 'doc/STP.md');
        });

        it('returns undefined for an unknown id', () => {
            assert.strictEqual(findBaselineDocument('NoSuchDoc'), undefined);
        });
    });

    describe('templatePath / sourcePath', () => {
        it('templatePath joins toolsDir with templates/<file>', () => {
            const doc = findBaselineDocument('SDD')!;
            assert.strictEqual(
                templatePath('/repo/tools', doc),
                path.join('/repo/tools', 'templates', 'SDD.md.j2'),
            );
        });

        it('sourcePath joins workspaceRoot with the doc-relative source', () => {
            const doc = findBaselineDocument('HLRs')!;
            assert.strictEqual(
                sourcePath('/repo', doc),
                path.join('/repo', 'doc/HLRs.md'),
            );
        });
    });
});
