// Static-analysis tests for MergeConflictResolver.
// Pins the contracts from:
//   LLR-MRG-07: resolve() detects Git MERGE state, reads blobs, calls merge_three_way
//   LLR-MRG-08: appendProvenance writes to ai_history.jsonl with required fields

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const resolverSrc = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'merge', 'MergeConflictResolver.ts'),
    'utf8',
);

describe('MergeConflictResolver — three-way merge (LLR-MRG-07)', () => {
    it('detects Git MERGE state via the vscode.git extension', () => {
        // LLR-MRG-07: resolve() must call vscode.extensions.getExtension('vscode.git')
        // to check whether a merge is in progress before proceeding.
        assert.ok(
            resolverSrc.includes("'vscode.git'") || resolverSrc.includes('"vscode.git"'),
            "MergeConflictResolver.ts must reference the 'vscode.git' extension",
        );
    });

    it('calls merge_three_way to merge base/ours/theirs blobs', () => {
        // LLR-MRG-07: the resolver must call merge_three_way (the sidecar method)
        // to produce the merged output.
        assert.ok(resolverSrc.includes('merge_three_way'),
            "MergeConflictResolver.ts must call merge_three_way");
    });
});

describe('MergeConflictResolver — AI provenance (LLR-MRG-08)', () => {
    it('writes provenance to ai_history.jsonl', () => {
        // LLR-MRG-08: appendProvenance must write an entry to .edit_doc/ai_history.jsonl.
        assert.ok(resolverSrc.includes('ai_history.jsonl'),
            "MergeConflictResolver.ts must write to ai_history.jsonl");
    });

    it('captures required provenance fields: intent, conflict_kind, conflict_key', () => {
        // LLR-MRG-08: the provenance record must include intent, conflict_kind,
        // conflict_key (plus base_sha1, ours_sha1, theirs_sha1, rationale, model, ts).
        assert.ok(resolverSrc.includes('intent'),
            "MergeConflictResolver.ts provenance must include 'intent'");
        assert.ok(resolverSrc.includes('conflict_kind'),
            "MergeConflictResolver.ts provenance must include 'conflict_kind'");
        assert.ok(resolverSrc.includes('conflict_key'),
            "MergeConflictResolver.ts provenance must include 'conflict_key'");
    });
});
