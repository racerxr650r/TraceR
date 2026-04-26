// Phase 6 (LLR-PKG-02): pin the `getToolsDir()` fallback so the
// extension keeps working when the workspace has no `tools/`
// directory at the configured `projectXml.toolsDir` — by falling
// back to the bundled `<extensionPath>/dist/python` tree shipped
// inside the `.vsix` (HLR-060).

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { __test as vscodeTest } from './__mocks__/vscode';
import { getToolsDir, setExtensionContext } from '../../src/util/paths';

function withTempDir(fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-paths-fb-'));
    try {
        fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function fakeContext(extensionPath: string): { extensionPath: string } {
    // Only `extensionPath` is touched by `paths.ts`; cast is safe.
    return { extensionPath };
}

describe('util/paths — bundled tools fallback (LLR-PKG-02)', () => {
    afterEach(() => {
        vscodeTest.reset();
        // Clear the module-level extensionContext.
        setExtensionContext(undefined);
    });

    it('returns the workspace tools/ when project_io.py exists there', () => {
        withTempDir((root) => {
            const tools = path.join(root, 'tools');
            fs.mkdirSync(path.join(root, 'doc'), { recursive: true });
            fs.mkdirSync(tools, { recursive: true });
            fs.writeFileSync(path.join(root, 'doc', 'Project.xml'), '<project/>');
            fs.writeFileSync(path.join(tools, 'project_io.py'), '# stub\n');

            vscodeTest.setWorkspaceFolders([vscodeTest.folder(root, 'r', 0)]);
            // Set a bundled fallback that should NOT be picked when
            // the workspace tools/ is intact.
            withTempDir((extDir) => {
                const bundled = path.join(extDir, 'dist', 'python');
                fs.mkdirSync(bundled, { recursive: true });
                fs.writeFileSync(path.join(bundled, 'project_io.py'), '# bundled\n');
                setExtensionContext(fakeContext(extDir) as unknown as vscode.ExtensionContext);

                assert.strictEqual(getToolsDir(), tools);
            });
        });
    });

    it('falls back to <extensionPath>/dist/python when the workspace tools/ is missing', () => {
        withTempDir((root) => {
            // Workspace exists with Project.xml but no tools/ directory.
            fs.mkdirSync(path.join(root, 'doc'), { recursive: true });
            fs.writeFileSync(path.join(root, 'doc', 'Project.xml'), '<project/>');
            vscodeTest.setWorkspaceFolders([vscodeTest.folder(root, 'r', 0)]);

            withTempDir((extDir) => {
                const bundled = path.join(extDir, 'dist', 'python');
                fs.mkdirSync(bundled, { recursive: true });
                fs.writeFileSync(path.join(bundled, 'project_io.py'), '# bundled\n');
                setExtensionContext(fakeContext(extDir) as unknown as vscode.ExtensionContext);

                assert.strictEqual(getToolsDir(), bundled);
            });
        });
    });

    it('returns the workspace path (which the caller can fail loudly on) when neither the workspace tools/ nor the bundled tree exist', () => {
        withTempDir((root) => {
            fs.mkdirSync(path.join(root, 'doc'), { recursive: true });
            fs.writeFileSync(path.join(root, 'doc', 'Project.xml'), '<project/>');
            vscodeTest.setWorkspaceFolders([vscodeTest.folder(root, 'r', 0)]);

            withTempDir((extDir) => {
                // Note: NO dist/python under extDir.
                setExtensionContext(fakeContext(extDir) as unknown as vscode.ExtensionContext);
                // The result is the unverified workspace path; callers
                // (sidecar) raise a clear error when project_io.py is
                // absent. We simply pin that the function does not
                // throw and does not hand back the bundled path.
                const got = getToolsDir();
                assert.strictEqual(got, path.join(root, 'tools'));
            });
        });
    });
});
