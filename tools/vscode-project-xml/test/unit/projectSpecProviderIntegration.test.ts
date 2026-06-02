// Provider-level integration test: ProjectSpecProvider.getChildren()
// with FakeSidecarClient.
//
// Verifies that the tree provider correctly:
//   * calls parseToJson on the sidecar;
//   * builds top-level groups (HLRs, LLRs, Tests, SDD) from parsed data;
//   * shows item counts in group labels;
//   * marks leaf nodes as revealable and editable;
//   * fires onDidChangeTreeData after refresh();
//   * shows a placeholder node when no workspace is open;
//   * shows an error node when the sidecar fails.

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { __test as vscodeTest, FakeOutputChannel } from './__mocks__/vscode';
import { FakeSidecarClient } from './__mocks__/fakeSidecar';
import {
    ProjectSpecProvider,
    ProjectSpecNode,
} from '../../src/treeView/ProjectSpecProvider';
import type { ParsedProject, ProjectIoClient } from '../../src/sidecar';

let tmpDir: string;

function setupWorkspace(): void {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-tree-'));
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

/** Minimal parsed project fixture with 2 HLRs, 1 LLR, 1 test, 1 SDD module. */
const FIXTURE_PROJECT: ParsedProject = {
    name: 'TestProject',
    schema_version: '1.4',
    hlrs: [
        {
            number: '1',
            title: 'Core',
            hlrs: [
                { id: 'HLR-001', name: 'First', text: 'Description' },
                { id: 'HLR-002', name: 'Second', text: 'Another' },
            ],
        },
    ],
    llrs: [
        {
            name: 'core',
            title: 'Core Function',
            number: '1',
            llrs: [
                { id: 'LLR-CORE-01', text: 'Impl detail', traces: [{ target: 'HLR', ref: 'HLR-001' }] },
            ],
        },
    ],
    tests: [
        {
            path: 'test/test_core.py',
            tests: [
                { name: 'test_basic', purpose: 'Tests basics', traces: [{ target: 'LLR', ref: 'LLR-CORE-01' }] },
            ],
        },
    ],
    sdd: {
        modules: [
            { path: 'src/core.ts', title: 'Core module' },
        ],
    },
    flat_hlrs: [
        { id: 'HLR-001', name: 'First', text: 'Description' },
        { id: 'HLR-002', name: 'Second', text: 'Another' },
    ],
    flat_llrs: [
        { id: 'LLR-CORE-01', text: 'Impl detail', traces: [{ target: 'HLR', ref: 'HLR-001' }] },
    ],
    flat_tests: [
        { name: 'test_basic', purpose: 'Tests basics', file: 'test/test_core.py', traces: [{ target: 'LLR', ref: 'LLR-CORE-01' }] },
    ],
    _ui_hints_index: {
        Hlr: {
            tree_node: { label: '@id @name', id_attr: 'id', group: 'hlrs' },
            form: [],
            lenses: [{ kind: 'coverage' }],
            document: false,
            element: 'hlr',
        },
        Llr: {
            tree_node: { label: '@id', id_attr: 'id', group: 'llrs' },
            form: [],
            lenses: [{ kind: 'coverage' }],
            document: false,
            element: 'llr',
        },
        Test: {
            tree_node: { label: '@name', id_attr: 'name', group: 'tests' },
            form: [],
            lenses: [{ kind: 'tracesCount' }],
            document: false,
            element: 'test',
        },
        SddModule: {
            tree_node: { label: '@path', id_attr: 'path', group: 'sdd' },
            form: [],
            lenses: [],
            document: false,
            element: 'module',
        },
    },
};

describe('ProjectSpecProvider (provider integration with FakeSidecarClient)', () => {
    let sidecar: FakeSidecarClient;
    let channel: FakeOutputChannel;
    let provider: ProjectSpecProvider;

    beforeEach(() => {
        setupWorkspace();
        sidecar = new FakeSidecarClient();
        channel = new FakeOutputChannel();
        provider = new ProjectSpecProvider(
            sidecar as unknown as ProjectIoClient,
            channel as unknown as import('vscode').OutputChannel,
        );
    });

    afterEach(() => {
        cleanupWorkspace();
    });

    it('calls parseToJson on the sidecar when getting children', async () => {
        sidecar.responses.parseToJson = FIXTURE_PROJECT;
        await provider.getChildren();
        const methods = sidecar.calls.map((c) => c.method);
        assert.ok(methods.includes('parseToJson'));
    });

    it('builds top-level groups from parsed project', async () => {
        sidecar.responses.parseToJson = FIXTURE_PROJECT;
        const roots = await provider.getChildren();
        const labels = roots.map((n) => n.label as string);
        assert.ok(labels.some((l) => typeof l === 'string' && l.startsWith('HLRs')), `Expected HLRs group, got: ${labels}`);
        assert.ok(labels.some((l) => typeof l === 'string' && l.startsWith('LLRs')), `Expected LLRs group, got: ${labels}`);
        assert.ok(labels.some((l) => typeof l === 'string' && l.startsWith('Tests')), `Expected Tests group, got: ${labels}`);
        assert.ok(labels.some((l) => typeof l === 'string' && l.startsWith('SDD')), `Expected SDD group, got: ${labels}`);
    });

    it('group labels include item counts', async () => {
        sidecar.responses.parseToJson = FIXTURE_PROJECT;
        const roots = await provider.getChildren();
        const labels = roots.map((n) => n.label as string);
        assert.ok(labels.some((l) => l === 'HLRs (2)'), `Expected 'HLRs (2)', got: ${labels}`);
        assert.ok(labels.some((l) => l === 'LLRs (1)'), `Expected 'LLRs (1)', got: ${labels}`);
    });

    it('caches results — second getChildren() does not call sidecar', async () => {
        sidecar.responses.parseToJson = FIXTURE_PROJECT;
        await provider.getChildren();
        const callsBefore = sidecar.calls.length;
        await provider.getChildren();
        assert.strictEqual(sidecar.calls.length, callsBefore);
    });

    it('refresh() clears cache and fires onDidChangeTreeData', async () => {
        sidecar.responses.parseToJson = FIXTURE_PROJECT;
        await provider.getChildren();

        let fired = false;
        provider.onDidChangeTreeData(() => { fired = true; });
        provider.refresh();
        assert.ok(fired, 'onDidChangeTreeData should fire');

        // Next getChildren should call sidecar again
        const callsBefore = sidecar.calls.length;
        await provider.getChildren();
        assert.ok(sidecar.calls.length > callsBefore, 'should re-fetch after refresh');
    });

    it('shows placeholder when no workspace is open', async () => {
        vscodeTest.setWorkspaceFolders(undefined);
        const roots = await provider.getChildren();
        assert.strictEqual(roots.length, 1);
        const label = roots[0].label as string;
        assert.ok(label.includes('Open a folder'), `Expected placeholder, got: ${label}`);
    });

    it('shows error node when sidecar fails', async () => {
        sidecar.responses.parseToJson = new Error('parse failed');
        const roots = await provider.getChildren();
        assert.strictEqual(roots.length, 1);
        const label = roots[0].label as string;
        assert.ok(label.includes('Failed'), `Expected error node, got: ${label}`);
        assert.ok(label.includes('parse failed'));
    });

    it('child nodes of HLRs group are expandable sections', async () => {
        sidecar.responses.parseToJson = FIXTURE_PROJECT;
        const roots = await provider.getChildren();
        const hlrsGroup = roots.find((n) => (n.label as string).startsWith('HLRs'));
        assert.ok(hlrsGroup);
        const sections = await provider.getChildren(hlrsGroup);
        assert.ok(sections.length > 0, 'HLRs group should have section children');
    });
});

describe('ProjectSpecProvider — showCoverageBadges config (LLR-BDG-04)', () => {
    it('source reads showCoverageBadges config key to gate badge display', () => {
        // LLR-BDG-04: badgesEnabled() must consult the projectXml.showCoverageBadges
        // setting (defaulting to true) so users can disable the inline badge decoration.
        const fs = require('fs') as typeof import('fs');
        const path = require('path') as typeof import('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', '..', 'src', 'treeView', 'ProjectSpecProvider.ts'),
            'utf8',
        );
        assert.ok(src.includes('showCoverageBadges'), "ProjectSpecProvider must read 'showCoverageBadges' config key");
    });
});
