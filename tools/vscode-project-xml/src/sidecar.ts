// Long-running JSON-RPC 2.0 client over stdio for tools/project_io.py.
//
// Speaks line-delimited JSON requests; each request gets exactly one
// response identified by its numeric id. The sidecar is spawned lazily
// on first use and torn down on dispose() (extension deactivate).

import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as path from 'path';
import {
    describeWorkspaceState,
    getConfig,
    getProjectIoScript,
    getToolsDir,
} from './util/paths';

export class SidecarError extends Error {
    constructor(public code: number, message: string) {
        super(message);
        this.name = 'SidecarError';
    }
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
}

export class ProjectIoClient implements vscode.Disposable {
    private proc: ChildProcessWithoutNullStreams | undefined;
    private pending = new Map<number, PendingRequest>();
    private buffer = '';
    private nextId = 1;
    private startError: Error | undefined;

    constructor(private readonly outputChannel: vscode.OutputChannel) {}

    async lint(params: Record<string, unknown> = {}): Promise<LintResult> {
        return this.request<LintResult>('lint', params);
    }

    async parseToJson(params: Record<string, unknown> = {}): Promise<ParsedProject> {
        return this.request<ParsedProject>('parse_to_json', params);
    }

    async listDocuments(
        params: Record<string, unknown> = {},
    ): Promise<ListDocumentsResult> {
        return this.request<ListDocumentsResult>('list_documents', params);
    }

    async render(params: RenderParams): Promise<RenderResult> {
        return this.request<RenderResult>('render', params as unknown as Record<string, unknown>);
    }

    private async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
        const proc = this.ensureStarted();
        const id = this.nextId++;
        const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, {
                resolve: (value) => resolve(value as T),
                reject,
            });
            proc.stdin.write(payload + '\n', (err) => {
                if (err) {
                    this.pending.delete(id);
                    reject(err);
                }
            });
        });
    }

    private ensureStarted(): ChildProcessWithoutNullStreams {
        if (this.proc && !this.proc.killed) {
            return this.proc;
        }
        if (this.startError) {
            throw this.startError;
        }
        const script = getProjectIoScript();
        const cwd = getToolsDir();
        if (!script || !cwd) {
            const err = new Error(describeWorkspaceState());
            this.startError = err;
            throw err;
        }
        const python = pickPython();
        this.outputChannel.appendLine(
            `[sidecar] spawn: ${python} ${script} (cwd=${path.dirname(script)})`,
        );
        const proc = spawn(python, [script], {
            cwd: path.dirname(script),
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        proc.stdout.setEncoding('utf8');
        proc.stderr.setEncoding('utf8');
        proc.stdout.on('data', (chunk: string) => this.onStdout(chunk));
        proc.stderr.on('data', (chunk: string) => {
            this.outputChannel.append(`[sidecar:stderr] ${chunk}`);
        });
        proc.on('error', (err) => {
            this.outputChannel.appendLine(
                `[sidecar] spawn error: ${err.message}`,
            );
            this.failAll(err);
        });
        proc.on('exit', (code, signal) => {
            this.outputChannel.appendLine(
                `[sidecar] exited code=${code} signal=${signal ?? ''}`,
            );
            const err = new Error(
                `project_io.py exited (code=${code}, signal=${signal ?? ''})`,
            );
            this.failAll(err);
            this.proc = undefined;
        });
        this.proc = proc;
        return proc;
    }

    private onStdout(chunk: string): void {
        this.buffer += chunk;
        let nl: number;
        // Each response is a single JSON object terminated by '\n'.
        while ((nl = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, nl).trim();
            this.buffer = this.buffer.slice(nl + 1);
            if (!line) {
                continue;
            }
            this.dispatchLine(line);
        }
    }

    private dispatchLine(line: string): void {
        let msg: { id?: number; result?: unknown; error?: { code: number; message: string } };
        try {
            msg = JSON.parse(line);
        } catch {
            this.outputChannel.appendLine(
                `[sidecar] invalid JSON line: ${line}`,
            );
            return;
        }
        if (typeof msg.id !== 'number') {
            return; // ignore notifications (none expected from server)
        }
        const pending = this.pending.get(msg.id);
        if (!pending) {
            return;
        }
        this.pending.delete(msg.id);
        if (msg.error) {
            pending.reject(new SidecarError(msg.error.code, msg.error.message));
        } else {
            pending.resolve(msg.result);
        }
    }

    private failAll(err: Error): void {
        for (const pending of this.pending.values()) {
            pending.reject(err);
        }
        this.pending.clear();
    }

    dispose(): void {
        const proc = this.proc;
        this.proc = undefined;
        this.failAll(new Error('sidecar disposed'));
        if (proc && !proc.killed) {
            try {
                proc.stdin.end();
            } catch {
                // ignore
            }
            proc.kill();
        }
    }
}

function pickPython(): string {
    const configured = getConfig().get<string>('pythonPath');
    if (configured && configured.trim() !== '') {
        return configured;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
}

// ----- response types -----------------------------------------------

export interface LintResult {
    errors: string[];
    warnings: string[];
    notes: string[];
    /** Phase 2.5 structured findings; one record per error/warning/note,
     *  carrying the optional `code` field that downstream Quick Fixes
     *  dispatch on. Absent on older sidecars. */
    items?: LintFinding[];
    ok: boolean;
}

export interface LintFinding {
    severity: 'error' | 'warning' | 'note';
    message: string;
    code: string | null;
}

export interface DocumentInfo {
    id: string;
    title: string;
    source: string;
    version: string;
    date: string;
    author: string;
    /** Workspace-relative path to the Jinja2 template, sourced from the
     *  optional `template=` attribute on `<metadata><document>` (or the
     *  `tools/templates/<id>.md.j2` convention when the attribute is
     *  omitted). */
    template: string;
    /** Workspace-relative output path, sourced from the optional
     *  `output=` attribute (or `source` when omitted). */
    output: string;
}

export interface ListDocumentsResult {
    documents: DocumentInfo[];
}

export interface RenderParams {
    template: string;
    metadata_id: string;
    xml_path?: string;
    /** When set, the sidecar writes the rendered output to this path. */
    out?: string;
}

export interface RenderResult {
    output: string;
    out_path: string | null;
}

export interface ParsedSection {
    number?: string;
    title?: string;
    hlrs?: ParsedHlr[];
}

/**
 * Phase 2.5b UI hint registry (urn:tracer:ui:v1).
 *
 * Payload-bearing elements (HLRs, LLRs, tests, SDD modules) may carry
 * optional `ui:icon`, `ui:color`, `ui:group` attributes. The XSD
 * accepts them via `xs:anyAttribute` and the Python renderer surfaces
 * them under `.ui` on each parsed node so the tree provider can
 * decorate items without knowing the underlying tag.
 *
 * - `icon`  - codicon name (e.g. "star", "warning"). Renders as the
 *             tree node's iconPath.
 * - `color` - VS Code ThemeColor id (e.g. "charts.blue"). Tints the
 *             icon when both are set.
 * - `group` - reserved; future tree-grouping hint (currently ignored).
 *
 * Absent on elements with no recognised hint, so consumers must guard
 * with optional chaining.
 */
export interface UiHints {
    icon?: string;
    color?: string;
    group?: string;
}

export interface ParsedHlr {
    id: string;
    name?: string;
    text?: string;
    traces?: ParsedTrace[];
    ui?: UiHints | null;
}

export interface ParsedLlrGroup {
    name?: string;
    title?: string;
    number?: string;
    llrs?: ParsedLlr[];
}

export interface ParsedLlr {
    id: string;
    text?: string;
    traces?: ParsedTrace[];
    ui?: UiHints | null;
}

export interface ParsedTestFile {
    path: string;
    tests?: ParsedTest[];
}

export interface ParsedTest {
    name: string;
    purpose?: string;
    traces?: ParsedTrace[];
    ui?: UiHints | null;
}

export interface ParsedTrace {
    target?: string;
    ref?: string;
    name?: string;
    [key: string]: string | undefined;
}

export interface ParsedSddModule {
    path?: string;
    title?: string;
    ui?: UiHints | null;
}

export interface ParsedSdd {
    modules?: ParsedSddModule[];
}

export interface ParsedStp {
    [key: string]: unknown;
}

export interface ParsedProject {
    name?: string;
    short_name?: string;
    schema_version?: string;
    sdd?: ParsedSdd | null;
    stp?: ParsedStp | null;
    hlrs?: ParsedSection[];
    llrs?: ParsedLlrGroup[];
    tests?: ParsedTestFile[];
    flat_hlrs?: ParsedHlr[];
    flat_llrs?: ParsedLlr[];
    flat_tests?: ParsedTest[];
}
