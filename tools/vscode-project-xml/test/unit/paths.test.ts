import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { __test as vscodeTest } from './__mocks__/vscode';
import {
    describeWorkspaceState,
    getProjectFolder,
    getProjectIoScript,
    getProjectXmlPath,
    getToolsDir,
    getXsdPath,
} from '../../src/util/paths';

function withTempDir(fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-paths-'));
    try {
        fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe('util/paths', () => {
    afterEach(() => {
        vscodeTest.reset();
    });

    describe('getProjectFolder', () => {
        it('returns undefined when no workspace folder is open', () => {
            // LLR-PTH-02: callers can fail loudly with a single null check.
            vscodeTest.setWorkspaceFolders(undefined);
            assert.strictEqual(getProjectFolder(), undefined);
        });

        it('picks the folder that contains the configured xmlPath', () => {
            // LLR-PTH-01: pick the folder whose root contains Project.xml,
            // not just the first folder in the list.
            withTempDir((root) => {
                const a = path.join(root, 'a');
                const b = path.join(root, 'b');
                fs.mkdirSync(path.join(b, 'doc'), { recursive: true });
                fs.mkdirSync(a);
                fs.writeFileSync(path.join(b, 'doc', 'Project.xml'), '<project/>');
                vscodeTest.setWorkspaceFolders([
                    vscodeTest.folder(a, 'a', 0),
                    vscodeTest.folder(b, 'b', 1),
                ]);
                const folder = getProjectFolder();
                assert.strictEqual(folder?.uri.fsPath, b);
            });
        });

        it('falls back to the first folder when no folder contains Project.xml', () => {
            withTempDir((root) => {
                vscodeTest.setWorkspaceFolders([vscodeTest.folder(root, 'only', 0)]);
                assert.strictEqual(getProjectFolder()?.uri.fsPath, root);
            });
        });
    });

    describe('getProjectXmlPath / getXsdPath / getToolsDir / getProjectIoScript', () => {
        it('resolves relative settings against the project folder', () => {
            // LLR-PTH-02: every relative setting is resolved against
            // getProjectFolder()'s root.
            withTempDir((root) => {
                fs.mkdirSync(path.join(root, 'doc'));
                fs.writeFileSync(path.join(root, 'doc', 'Project.xml'), '<project/>');
                vscodeTest.setWorkspaceFolders([vscodeTest.folder(root, 'r', 0)]);
                assert.strictEqual(
                    getProjectXmlPath(),
                    path.join(root, 'doc/Project.xml'),
                );
                assert.strictEqual(
                    getXsdPath(),
                    path.join(root, 'tools/project.xsd'),
                );
                assert.strictEqual(getToolsDir(), path.join(root, 'tools'));
                assert.strictEqual(
                    getProjectIoScript(),
                    path.join(root, 'tools', 'project_io.py'),
                );
            });
        });

        it('returns absolute settings verbatim', () => {
            // LLR-PTH-02: an absolute path setting is returned verbatim.
            withTempDir((root) => {
                vscodeTest.setWorkspaceFolders([vscodeTest.folder(root, 'r', 0)]);
                vscodeTest.setConfig({
                    xmlPath: '/abs/Project.xml',
                    xsdPath: '/abs/project.xsd',
                    toolsDir: '/abs/tools',
                });
                assert.strictEqual(getProjectXmlPath(), '/abs/Project.xml');
                assert.strictEqual(getXsdPath(), '/abs/project.xsd');
                assert.strictEqual(getToolsDir(), '/abs/tools');
                assert.strictEqual(
                    getProjectIoScript(),
                    path.join('/abs/tools', 'project_io.py'),
                );
            });
        });

        it('returns undefined for every helper when no workspace folder is open', () => {
            vscodeTest.setWorkspaceFolders(undefined);
            assert.strictEqual(getProjectXmlPath(), undefined);
            assert.strictEqual(getXsdPath(), undefined);
            assert.strictEqual(getToolsDir(), undefined);
            assert.strictEqual(getProjectIoScript(), undefined);
        });
    });

    describe('describeWorkspaceState', () => {
        it('explains the no-folder case in actionable terms', () => {
            // LLR-PTH-03: a single sentence the sidecar / tree can show.
            vscodeTest.setWorkspaceFolders(undefined);
            const msg = describeWorkspaceState();
            assert.match(msg, /no workspace folder/i);
            assert.match(msg, /Open Folder/i);
        });

        it('names the missing Project.xml when folders are open', () => {
            withTempDir((root) => {
                vscodeTest.setWorkspaceFolders([vscodeTest.folder(root, 'r', 0)]);
                const msg = describeWorkspaceState();
                assert.match(msg, /doc\/Project\.xml/);
                assert.ok(
                    msg.includes(root),
                    `expected message to include workspace path; got: ${msg}`,
                );
            });
        });
    });
});
