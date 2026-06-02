// Static-analysis tests for the extension activation entry point and
// the package.json manifest. Pins the contracts from:
//   LLR-ACT-01: activate registers everything in context.subscriptions
//   LLR-ACT-02: OutputChannel is created before other components
//   LLR-ACT-03: onDidSaveTextDocument listener with autoLintOnChange / previewOnSave gates
//   LLR-ACT-04: extensionDependencies includes redhat.vscode-xml; untrustedWorkspaces limited

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const rootDir = path.resolve(__dirname, '..', '..');

describe('extension activate (LLR-ACT-01)', () => {
    it('registers commands via context.subscriptions.push', () => {
        const src = fs.readFileSync(path.join(rootDir, 'src', 'extension.ts'), 'utf8');
        assert.ok(src.includes('context.subscriptions'),
            "extension.ts must push to context.subscriptions");
    });
});

describe('extension activate — OutputChannel created first (LLR-ACT-02)', () => {
    it('OutputChannel creation appears before component instantiation in activate()', () => {
        const src = fs.readFileSync(path.join(rootDir, 'src', 'extension.ts'), 'utf8');
        const outputIdx = src.indexOf('createOutputChannel');
        assert.ok(outputIdx >= 0, "extension.ts must call createOutputChannel");
        // Verify OutputChannel is created before the 'new ProjectIoClient' call in activate()
        const newClientIdx = src.indexOf('new ProjectIoClient(');
        assert.ok(newClientIdx >= 0, "extension.ts must instantiate ProjectIoClient");
        assert.ok(outputIdx < newClientIdx,
            "createOutputChannel must appear before 'new ProjectIoClient' in extension.ts");
    });
});

describe('extension activate — save listener (LLR-ACT-03)', () => {
    it('subscribes to onDidSaveTextDocument with autoLintOnChange and previewOnSave gates', () => {
        const src = fs.readFileSync(path.join(rootDir, 'src', 'extension.ts'), 'utf8');
        assert.ok(src.includes('onDidSaveTextDocument'),
            "extension.ts must subscribe to onDidSaveTextDocument");
        assert.ok(src.includes('autoLintOnChange'),
            "extension.ts save listener must check autoLintOnChange");
        assert.ok(src.includes('previewOnSave'),
            "extension.ts save listener must check previewOnSave");
    });
});

describe('package.json manifest (LLR-ACT-04)', () => {
    const pkg = JSON.parse(
        fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;

    it('declares redhat.vscode-xml as an extension dependency', () => {
        const deps = pkg.extensionDependencies as string[] | undefined;
        assert.ok(Array.isArray(deps), "package.json must have extensionDependencies array");
        assert.ok(deps.includes('redhat.vscode-xml'),
            "package.json extensionDependencies must include 'redhat.vscode-xml'");
    });

    it('sets untrustedWorkspaces.supported to "limited"', () => {
        const capabilities = pkg.capabilities as Record<string, unknown> | undefined;
        assert.ok(capabilities, "package.json must have capabilities");
        const uw = capabilities.untrustedWorkspaces as Record<string, unknown> | undefined;
        assert.ok(uw, "package.json capabilities must have untrustedWorkspaces");
        assert.strictEqual(uw.supported, 'limited',
            "untrustedWorkspaces.supported must be 'limited'");
    });
});
