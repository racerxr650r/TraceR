import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';
import { FakeOutputChannel } from './__mocks__/vscode';
import { ProjectIoClient, SidecarError } from '../../src/sidecar';

// These tests cover the JSON-line framing and dispatch path of
// ProjectIoClient — the parts that don't depend on a spawned child
// process. We poke the private `pending` map and feed bytes to the
// private `onStdout` to drive the dispatcher.
//
// Casting through `unknown` keeps strict TypeScript quiet without
// changing the production type signatures.

interface PendingProbe {
    pending: Map<number, { resolve: (v: unknown) => void; reject: (err: Error) => void }>;
    nextId: number;
    buffer: string;
    onStdout(chunk: string): void;
    failAll(err: Error): void;
}

function probe(client: ProjectIoClient): PendingProbe {
    return client as unknown as PendingProbe;
}

describe('sidecar.ProjectIoClient (framing)', () => {
    let channel: FakeOutputChannel;
    let client: ProjectIoClient;

    beforeEach(() => {
        channel = new FakeOutputChannel();
        client = new ProjectIoClient(channel as unknown as vscode.OutputChannel);
    });

    afterEach(() => {
        client.dispose();
    });

    it('dispatches a complete response line to the matching pending request', async () => {
        // LLR-PIC-02: pending resolvers are keyed by id.
        const p = probe(client);
        const promise = new Promise<unknown>((resolve, reject) => {
            p.pending.set(7, { resolve, reject });
        });
        p.onStdout('{"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n');
        const result = await promise;
        assert.deepStrictEqual(result, { ok: true });
        assert.strictEqual(p.pending.size, 0);
    });

    it('reassembles a response split across multiple chunks', async () => {
        // LLR-PIC-02: framing must tolerate stdout boundaries that
        // bisect a JSON line.
        const p = probe(client);
        const promise = new Promise<unknown>((resolve, reject) => {
            p.pending.set(1, { resolve, reject });
        });
        p.onStdout('{"jsonrpc":"2.0","id":1,');
        p.onStdout('"result":');
        p.onStdout('"hello"}\n');
        const result = await promise;
        assert.strictEqual(result, 'hello');
    });

    it('dispatches multiple responses arriving in one chunk in id order', async () => {
        // LLR-PIC-02: out-of-order or batched responses still map to
        // the right resolver.
        const p = probe(client);
        const seen: number[] = [];
        const wait = (id: number) => new Promise<void>((resolve, reject) => {
            p.pending.set(id, {
                resolve: () => { seen.push(id); resolve(); },
                reject,
            });
        });
        const a = wait(1);
        const b = wait(2);
        p.onStdout(
            '{"jsonrpc":"2.0","id":2,"result":null}\n' +
            '{"jsonrpc":"2.0","id":1,"result":null}\n',
        );
        await Promise.all([a, b]);
        assert.deepStrictEqual(seen, [2, 1]);
    });

    it('rejects with SidecarError when the response carries an error object', async () => {
        // LLR-PIC-03: JSON-RPC errors surface as SidecarError(code, message)
        // so callers can switch on the code without parsing message text.
        const p = probe(client);
        const promise = new Promise<unknown>((resolve, reject) => {
            p.pending.set(5, { resolve, reject });
        });
        p.onStdout(
            '{"jsonrpc":"2.0","id":5,"error":{"code":-32601,"message":"no such method"}}\n',
        );
        await assert.rejects(promise, (err: unknown) => {
            assert.ok(err instanceof SidecarError);
            assert.strictEqual((err as SidecarError).code, -32601);
            assert.match((err as Error).message, /no such method/);
            return true;
        });
    });

    it('ignores blank lines and unknown ids without disturbing pending requests', async () => {
        // LLR-PIC-02: stray notifications and blank lines must not
        // accidentally resolve a pending request.
        const p = probe(client);
        let touched = false;
        p.pending.set(99, {
            resolve: () => { touched = true; },
            reject: () => { touched = true; },
        });
        p.onStdout('\n');
        p.onStdout('   \n');
        p.onStdout('{"jsonrpc":"2.0","id":42,"result":null}\n');
        // Yield a microtask to make sure no promise callbacks have run.
        await Promise.resolve();
        assert.strictEqual(touched, false);
        assert.strictEqual(p.pending.size, 1);
    });

    it('logs invalid JSON lines and continues without rejecting any pending request', async () => {
        const p = probe(client);
        let touched = false;
        p.pending.set(1, {
            resolve: () => { touched = true; },
            reject: () => { touched = true; },
        });
        p.onStdout('not json at all\n');
        await Promise.resolve();
        assert.strictEqual(touched, false);
        assert.ok(
            channel.lines.some((line) => /invalid JSON line/.test(line)),
            `expected an "invalid JSON line" log entry; got:\n${channel.lines.join('\n')}`,
        );
    });

    it('failAll rejects every pending request with the supplied error', async () => {
        // LLR-PIC-03: an unexpected sidecar exit must reject every
        // outstanding request rather than hanging the caller.
        const p = probe(client);
        const a = new Promise<unknown>((resolve, reject) => {
            p.pending.set(1, { resolve, reject });
        });
        const b = new Promise<unknown>((resolve, reject) => {
            p.pending.set(2, { resolve, reject });
        });
        const exitErr = new Error('sidecar exited (code=1)');
        p.failAll(exitErr);
        await assert.rejects(a, /sidecar exited/);
        await assert.rejects(b, /sidecar exited/);
        assert.strictEqual(p.pending.size, 0);
    });

    it('dispose rejects pending requests with a "sidecar disposed" error', async () => {
        // LLR-PIC-05: dispose() cleans up rather than leaking promises.
        const p = probe(client);
        const promise = new Promise<unknown>((resolve, reject) => {
            p.pending.set(1, { resolve, reject });
        });
        client.dispose();
        await assert.rejects(promise, /sidecar disposed/);
    });
});

describe('sidecar.SidecarError', () => {
    it('carries the JSON-RPC error code on a named SidecarError instance', () => {
        const err = new SidecarError(-32000, 'application error');
        assert.strictEqual(err.code, -32000);
        assert.strictEqual(err.name, 'SidecarError');
        assert.match(err.message, /application error/);
        assert.ok(err instanceof Error);
    });
});

describe('sidecar.ProjectIoClient (process lifecycle)', () => {
    it('does not spawn a process during construction (LLR-PIC-01)', () => {
        // LLR-PIC-01: the sidecar process must be started lazily on the first
        // request, not eagerly at construction time.
        const channel = new FakeOutputChannel();
        const client = new ProjectIoClient(
            channel as unknown as vscode.OutputChannel,
        );
        const proc = (client as unknown as { proc: unknown }).proc;
        assert.strictEqual(proc, undefined, 'proc should be undefined before any request');
        client.dispose();
    });
});

describe('sidecar (python picker — static inspection)', () => {
    it('source checks projectXml.pythonPath config setting (LLR-PIC-06)', () => {
        // LLR-PIC-06: pickPython() consults the projectXml.pythonPath VS Code
        // setting before falling back to the .venv / PATH heuristics.
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', '..', 'src', 'sidecar.ts'),
            'utf8',
        );
        assert.ok(src.includes('pythonPath'), "sidecar.ts must reference 'pythonPath' config key");
    });
});
