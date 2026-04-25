// Mocha setup for tier-1 unit tests.
//
// ts-node is registered ahead of this file via .mocharc.json so the
// .ts test files load directly. This file's only job is to hook the
// Node module resolver so any `require('vscode')` from src/** is
// redirected to our hand-rolled mock under
// test/unit/__mocks__/vscode.ts. That lets the production source
// load unchanged in a plain-Node test process — no
// @vscode/test-electron download, no extension host.

import * as path from 'path';

const Module = require('module') as {
    _resolveFilename: (
        request: string,
        parent: NodeJS.Module | null,
        ...rest: unknown[]
    ) => string;
};

const VSCODE_MOCK = path.resolve(__dirname, '__mocks__', 'vscode.ts');

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patched(
    request: string,
    parent: NodeJS.Module | null,
    ...rest: unknown[]
): string {
    if (request === 'vscode') {
        return VSCODE_MOCK;
    }
    return originalResolve.call(this, request, parent, ...rest);
};
