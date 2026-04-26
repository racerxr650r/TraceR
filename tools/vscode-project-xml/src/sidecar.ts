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

    async uiHintsIndex(
        params: Record<string, unknown> = {},
    ): Promise<UiHintsIndexResult> {
        return this.request<UiHintsIndexResult>('ui_hints_index', params);
    }

    async render(params: RenderParams): Promise<RenderResult> {
        return this.request<RenderResult>('render', params as unknown as Record<string, unknown>);
    }

    /**
     * Phase 3 write surface (HLR-018, HLR-019). Apply a list of
     * JSON-Patch-like operations to `doc/Project.xml`. The on-disk
     * file is byte-identical to its pre-call state when validation
     * fails; the structured findings are returned to the caller.
     */
    async applyEdit(params: ApplyEditParams): Promise<ApplyEditResult> {
        return this.request<ApplyEditResult>(
            'apply_edit',
            params as unknown as Record<string, unknown>,
        );
    }

    /**
     * Phase 3: derive a JSON Schema + RJSF uiSchema for a complex
     * type's UI form (payload-agnostic; keyed on the complex-type
     * name like `"Hlr"` or `"Llr"`).
     */
    async formSchema(params: FormSchemaParams): Promise<FormSchemaResult> {
        return this.request<FormSchemaResult>(
            'form_schema',
            params as unknown as Record<string, unknown>,
        );
    }

    /** Phase 3 (HLR-005): allocate the next free HLR-NNN / LLR-XXX-NN id. */
    async nextFreeId(params: NextFreeIdParams): Promise<{ id: string }> {
        return this.request<{ id: string }>(
            'next_free_id',
            params as unknown as Record<string, unknown>,
        );
    }

    /**
     * Phase 4 (HLR-005): bootstrap a brand-new project. Wraps the
     * sidecar's `init_project` JSON-RPC method (which itself wraps
     * `render_doc.init_project`). Writes a skeleton `Project.xml`
     * and a populated `PVD.md` to the configured paths and returns
     * their resolved locations. Refuses to overwrite existing files
     * unless `force=true`.
     */
    async initProject(params: InitProjectParams): Promise<InitProjectResult> {
        return this.request<InitProjectResult>(
            'init_project',
            params as unknown as Record<string, unknown>,
        );
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

// ---------- Phase 3: apply_edit / form_schema / next_free_id ----------

/** A single JSON-Patch-like operation accepted by `apply_edit`. */
export interface EditOperation {
    op: 'replace' | 'add' | 'remove';
    path: string;
    value?: unknown;
}

export interface ApplyEditParams {
    operations: EditOperation[];
    xml_path?: string;
    xsd_path?: string;
    /** When true (the default), the write only happens if the post-edit
     *  candidate produces zero error-severity findings. */
    expect_clean?: boolean;
}

export interface ApplyEditResult {
    ok: boolean;
    written: boolean;
    findings: LintResult;
    operations_applied: number;
}

export interface FormSchemaParams {
    /** Complex-type name, e.g. `"Hlr"` or `"Llr"`. */
    type: string;
    /** Snapshot of ids to populate `ref:HLR` / `ref:LLR` / `ref:SDD` selectors. */
    refs?: Record<string, string[]>;
    xsd_path?: string;
}

export interface FormSchemaResult {
    schema: Record<string, unknown>;
    uiSchema: Record<string, unknown>;
    fields: UiFormField[];
    type: string;
}

export interface NextFreeIdParams {
    kind: 'hlr' | 'llr';
    /** Required when kind === 'llr' (the function/section prefix). */
    function?: string;
    xml_path?: string;
}

// ---------- Phase 4: init_project --------------------------------------

export interface InitProjectParams {
    name: string;
    short_name: string;
    /** Defaults to `"TBD"` on the Python side. */
    author?: string;
    /** Workspace-absolute path. Defaults to the renderer's `PROJECT_XML`. */
    xml_path?: string;
    pvd_path?: string;
    pvd_template?: string;
    /** When true, overwrite existing files; default false (refuse). */
    force?: boolean;
}

export interface InitProjectResult {
    xml_path: string;
    pvd_path: string;
    /** Files that already existed and were overwritten (only populated
     *  when the call passed `force=true`). */
    existing: string[];
}

/**
 * Phase 2.5b UI hint vocabulary distilled from `<xs:appinfo>` blocks
 * in `tools/project.xsd` (urn:tracer:ui:v1).
 *
 * The Python sidecar's `ui_hints_index` method walks every renderable
 * complex type in the schema and returns one entry per type, keyed by
 * the type's `@name`. Inline complex types under named elements are
 * keyed under the parent (e.g. `Plan/item`). Types without a
 * `<xs:appinfo>` block are absent from the index.
 *
 * Phase 2.5b consumers (the generic tree provider, lens provider,
 * locator, and Phase 3 form panels) read this index instead of
 * special-casing per-payload element names.
 *
 * See doc/Schema_Reference.md §16 for the contract.
 */
export interface UiTreeNode {
    label: string;
    /** Attribute used to identify the element for reveal-in-XML. */
    id_attr: string;
    /** Slash-separated path under which siblings cluster (e.g. `hlrs`). */
    group: string;
}

export interface UiFormField {
    /** Name of the attribute or child element this field edits. */
    target: string;
    /** Whether the field targets an attribute (`attr`) or child (`child`). */
    kind: 'attr' | 'child';
    /** Editor type: `text` | `textarea` | `enum` | `ref:HLR` | `ref:LLR` | `ref:SDD` | `cdata`. */
    field: string;
    required: boolean;
}

export interface UiLens {
    /** `coverage`, `tracesCount`, or a custom kind handled by the lens provider. */
    kind: string;
}

export interface UiHintEntry {
    tree_node: UiTreeNode | null;
    form: UiFormField[];
    lenses: UiLens[];
    /** True for `Document` (the discoverability marker) and any other
     *  type that carries `<ui:document/>`. */
    document: boolean;
    /** Slice D: the lowercase XML element bound to this complex type
     *  (e.g. `"hlr"` for `Hlr`, `"item"` for `Plan/item`). Lets
     *  consumers iterate the parsed tree without hard-coding tag
     *  names. Null when no `<xs:element type="...">` declaration
     *  binds the type. */
    element: string | null;
}

export type UiHintsIndex = Record<string, UiHintEntry>;

export interface UiHintsIndexResult {
    ui_hints_index: UiHintsIndex;
}

/**
 * Phase 2.5b Slice D: a generic parsed node, surfaced under
 * `ParsedProject._nodes` and keyed by complex-type name (matching
 * `UiHintsIndex`). Lets the tree provider, lens provider, and Phase
 * 3 form panels iterate every payload that carries a `ui:treeNode`
 * hint without referencing per-payload tag names.
 */
export interface ParsedNode {
    /** Actual lowercase XML element name (matches `UiHintEntry.element`). */
    tag: string;
    /** Non-namespaced XML attributes verbatim from the source. */
    attrs: Record<string, string>;
    /** Attributes from the `urn:tracer:ui:v1` namespace (icon, color,
     *  group, ...) collected separately so the tree provider can
     *  apply them via `applyHintsToNode()`. Null when no UI attrs. */
    ui: Record<string, string> | null;
    /** Stripped element text content; null when empty. */
    text: string | null;
}

export type ParsedNodesIndex = Record<string, ParsedNode[]>;

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
    /** Phase 2.5b: the same UI hint vocabulary returned by
     *  `ui_hints_index`, embedded under an underscore-prefixed key so
     *  callers fetch parse + hints in one round trip. Absent on older
     *  sidecars. */
    _ui_hints_index?: UiHintsIndex;
    /** Slice D: generic parsed-node index keyed by complex-type name.
     *  Mirrors `_ui_hints_index` so a single round trip surfaces every
     *  payload that carries a `ui:treeNode` hint without per-tag
     *  builders. Absent on older sidecars. */
    _nodes?: ParsedNodesIndex;
}
