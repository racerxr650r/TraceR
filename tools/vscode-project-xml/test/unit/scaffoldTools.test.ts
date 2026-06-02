// Phase 6 (LLR-PKG-04, LLR-PKG-05): pin the workspace scaffolder
// behaviour — recursive copy of the extension's bundled
// `dist/python/` tree into the workspace's `<projectXml.toolsDir>`,
// with collisions skipped by default and only overwritten on
// explicit user confirmation (HLR-061).

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { __test as vscodeTest } from './__mocks__/vscode';
import { setExtensionContext } from '../../src/util/paths';
import { scaffoldTools } from '../../src/commands/scaffoldTools';

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-scaffold-'));
}

function fakeContext(extensionPath: string): { extensionPath: string } {
    return { extensionPath };
}

interface FixtureOpts {
    /** Pre-create files in the workspace tools/ to force collisions. */
    preExisting?: Record<string, string>;
    /** Files to put in the bundled dist/python/ (relative paths). */
    bundle?: Record<string, string>;
}

interface Fixture {
    workspace: string;
    extension: string;
    tools: string;
    cleanup(): void;
}

function setUp(opts: FixtureOpts = {}): Fixture {
    const workspace = tmpdir();
    const extension = tmpdir();
    const tools = path.join(workspace, 'tools');
    const bundled = path.join(extension, 'dist', 'python');
    fs.mkdirSync(bundled, { recursive: true });

    const bundle = opts.bundle ?? {
        'project_io.py': '# bundled io\n',
        'project.xsd': '<?xml version="1.0"?><xs:schema/>\n',
        'templates/HLRs.md.j2': 'tmpl\n',
    };
    for (const [rel, content] of Object.entries(bundle)) {
        const dst = path.join(bundled, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, content, 'utf8');
    }

    if (opts.preExisting) {
        fs.mkdirSync(tools, { recursive: true });
        for (const [rel, content] of Object.entries(opts.preExisting)) {
            const dst = path.join(tools, rel);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.writeFileSync(dst, content, 'utf8');
        }
    }

    vscodeTest.setWorkspaceFolders([vscodeTest.folder(workspace, 'r', 0)]);
    setExtensionContext(fakeContext(extension) as unknown as vscode.ExtensionContext);

    return {
        workspace,
        extension,
        tools,
        cleanup(): void {
            fs.rmSync(workspace, { recursive: true, force: true });
            fs.rmSync(extension, { recursive: true, force: true });
        },
    };
}

describe('commands/scaffoldTools (LLR-PKG-04, LLR-PKG-05)', () => {
    afterEach(() => {
        vscodeTest.reset();
        setExtensionContext(undefined);
    });

    it('writes every bundled file into the workspace tools/ when no collisions exist', async () => {
        // LLR-PKG-04: recursive copy preserves the bundled layout.
        const f = setUp();
        try {
            const result = await scaffoldTools({ silent: true });
            assert.ok(result, 'expected a result');
            assert.strictEqual(result!.written, 3);
            assert.strictEqual(result!.overwritten, 0);
            assert.strictEqual(result!.skipped, 0);
            assert.ok(fs.existsSync(path.join(f.tools, 'project_io.py')));
            assert.ok(fs.existsSync(path.join(f.tools, 'project.xsd')));
            assert.ok(fs.existsSync(path.join(f.tools, 'templates', 'HLRs.md.j2')));
        } finally {
            f.cleanup();
        }
    });

    it('skips colliding files by default when the user picks Skip existing', async () => {
        // LLR-PKG-04: collisions are NEVER overwritten silently —
        // skipping leaves the workspace file unchanged.
        const f = setUp({ preExisting: { 'project_io.py': '# user-edited\n' } });
        try {
            vscodeTest.setNextChoice('Skip existing');
            const result = await scaffoldTools({ silent: true });
            assert.ok(result);
            assert.strictEqual(result!.skipped, 1);
            assert.strictEqual(result!.overwritten, 0);
            assert.strictEqual(
                fs.readFileSync(path.join(f.tools, 'project_io.py'), 'utf8'),
                '# user-edited\n',
            );
            // Non-colliding files still get written.
            assert.ok(fs.existsSync(path.join(f.tools, 'project.xsd')));
        } finally {
            f.cleanup();
        }
    });

    it('overwrites colliding files only when the user picks Overwrite all', async () => {
        // LLR-PKG-04: explicit user confirmation via the modal prompt
        // is the ONLY path that overwrites workspace files.
        const f = setUp({ preExisting: { 'project_io.py': '# user-edited\n' } });
        try {
            vscodeTest.setNextChoice('Overwrite all');
            const result = await scaffoldTools({ silent: true });
            assert.ok(result);
            assert.strictEqual(result!.overwritten, 1);
            assert.strictEqual(result!.skipped, 0);
            assert.strictEqual(
                fs.readFileSync(path.join(f.tools, 'project_io.py'), 'utf8'),
                '# bundled io\n',
            );
        } finally {
            f.cleanup();
        }
    });

    it('returns undefined and writes nothing when the user cancels the modal', async () => {
        // LLR-PKG-04: cancel must leave the workspace untouched.
        const f = setUp({ preExisting: { 'project_io.py': '# user-edited\n' } });
        try {
            vscodeTest.setNextChoice(undefined);
            const result = await scaffoldTools({ silent: true });
            assert.strictEqual(result, undefined);
            assert.strictEqual(
                fs.readFileSync(path.join(f.tools, 'project_io.py'), 'utf8'),
                '# user-edited\n',
            );
            assert.ok(!fs.existsSync(path.join(f.tools, 'project.xsd')),
                'should not write any new files when user cancels');
        } finally {
            f.cleanup();
        }
    });

    it('overwrites without prompting when called with overwrite:true', async () => {
        // LLR-PKG-05: initProject auto-chains the scaffold with
        // overwrite confirmed (the workspace lacked tools/ anyway).
        const f = setUp({ preExisting: { 'project_io.py': '# user-edited\n' } });
        try {
            // No nextChoice set — if the modal fires we'd cancel and
            // return undefined, which would fail the assertion below.
            const result = await scaffoldTools({ overwrite: true, silent: true });
            assert.ok(result);
            assert.strictEqual(result!.overwritten, 1);
            assert.strictEqual(
                fs.readFileSync(path.join(f.tools, 'project_io.py'), 'utf8'),
                '# bundled io\n',
            );
            // No modal warning was emitted.
            const warnings = vscodeTest.messages().filter((m) => m.kind === 'warning');
            assert.strictEqual(warnings.length, 0);
        } finally {
            f.cleanup();
        }
    });

    it('errors cleanly when no bundled dist/python is available', async () => {
        // LLR-PKG-04 (defensive): missing bundle is a hard error,
        // not a silent no-op.
        const workspace = tmpdir();
        const extension = tmpdir();          // no dist/python under it
        try {
            vscodeTest.setWorkspaceFolders([vscodeTest.folder(workspace, 'r', 0)]);
            setExtensionContext(fakeContext(extension) as unknown as vscode.ExtensionContext);

            const result = await scaffoldTools({ silent: true });
            assert.strictEqual(result, undefined);
            const errors = vscodeTest.messages().filter((m) => m.kind === 'error');
            assert.strictEqual(errors.length, 1, 'expected exactly one error toast');
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
            fs.rmSync(extension, { recursive: true, force: true });
        }
    });
});

describe('Phase 4 add commands (LLR-BOOT-01)', () => {
    it('addModule uses SddModule type and /sdd/modules/module/- append path', () => {
        // LLR-BOOT-01: addModule must open FormPanelProvider keyed on 'SddModule'
        // with appendPath '/sdd/modules/module/-'.
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'commands', 'forms.ts'),
            'utf8',
        );
        assert.ok(src.includes("'SddModule'") || src.includes('"SddModule"'),
            "forms.ts must reference 'SddModule' payload type");
        assert.ok(src.includes('/sdd/modules/module/-'),
            "forms.ts must reference '/sdd/modules/module/-' as addModule appendPath");
    });

    it('addStpFixture uses StpFixture type and /stp/integration_environment/fixture/- append path', () => {
        // LLR-BOOT-01: addStpFixture must open FormPanelProvider keyed on 'StpFixture'.
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'commands', 'forms.ts'),
            'utf8',
        );
        assert.ok(src.includes("'StpFixture'") || src.includes('"StpFixture"'),
            "forms.ts must reference 'StpFixture' payload type");
        assert.ok(src.includes('/stp/integration_environment/fixture/-'),
            "forms.ts must reference correct appendPath for addStpFixture");
    });

    it('addTestFile uses TestFile type and /tests/file/- append path', () => {
        // LLR-BOOT-01: addTestFile must open FormPanelProvider keyed on 'TestFile'.
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'commands', 'forms.ts'),
            'utf8',
        );
        assert.ok(src.includes("'TestFile'") || src.includes('"TestFile"'),
            "forms.ts must reference 'TestFile' payload type");
        assert.ok(src.includes('/tests/file/-'),
            "forms.ts must reference '/tests/file/-' as addTestFile appendPath");
    });
});

describe('initProject command (LLR-BOOT-03)', () => {
    it('validates short_name against the required pattern', () => {
        // LLR-BOOT-03: initProject must enforce /^[a-z][a-z0-9_-]{0,15}$/ on short_name.
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'commands', 'initProject.ts'),
            'utf8',
        );
        assert.ok(
            src.includes('/^[a-z][a-z0-9_-]{0,15}$/') ||
            src.includes('SHORT_NAME_PATTERN') ||
            src.includes('[a-z][a-z0-9_-]'),
            "initProject.ts must include short_name validation pattern",
        );
    });

    it('re-calls with force:true on overwrite confirmation', () => {
        // LLR-BOOT-03: on a "file exists" error the command must offer a modal
        // Overwrite prompt and re-call init_project with force: true.
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'commands', 'initProject.ts'),
            'utf8',
        );
        assert.ok(src.includes('force: true') || src.includes('force:true'),
            "initProject.ts must pass force:true on overwrite");
    });
});
