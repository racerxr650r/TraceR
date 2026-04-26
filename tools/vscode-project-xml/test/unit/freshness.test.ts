import * as assert from 'assert';
import { compareVersions } from '../../src/util/freshness';

describe('util/freshness', () => {
    describe('compareVersions', () => {
        it('returns 0 for equal versions', () => {
            // LLR-PKG-07: equal bundle/workspace pins must NOT trigger
            // the freshness notification.
            assert.strictEqual(compareVersions('1.5', '1.5'), 0);
            assert.strictEqual(compareVersions('1.5.0', '1.5'), 0);
        });

        it('returns 1 when bundled is newer', () => {
            // LLR-PKG-07: only a strictly-greater bundled version
            // surfaces the one-shot notification.
            assert.strictEqual(compareVersions('1.6', '1.5'), 1);
            assert.strictEqual(compareVersions('2.0', '1.99'), 1);
            assert.strictEqual(compareVersions('1.5.1', '1.5'), 1);
        });

        it('returns -1 when bundled is older', () => {
            // LLR-PKG-07: an older bundled version must NOT nag the
            // user — the workspace pin remains authoritative.
            assert.strictEqual(compareVersions('1.4', '1.5'), -1);
            assert.strictEqual(compareVersions('1.5', '1.5.1'), -1);
        });

        it('handles non-numeric components as zero', () => {
            assert.strictEqual(compareVersions('1.x', '1.0'), 0);
        });
    });
});
