// Hand-rolled `vscode` API mock for tier-1 unit tests.
//
// Implements only the surface area that paths.ts, locator.ts,
// documents.ts, and the JSON-line framing of sidecar.ts touch.
// Add to it sparingly; the goal is a tight contract, not a
// VS Code reimplementation.

export class Position {
    constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
    public readonly start: Position;
    public readonly end: Position;
    constructor(
        startLineOrStart: number | Position,
        startCharOrEnd: number | Position,
        endLine?: number,
        endChar?: number,
    ) {
        if (typeof startLineOrStart === 'number') {
            this.start = new Position(startLineOrStart as number, startCharOrEnd as number);
            this.end = new Position(endLine ?? 0, endChar ?? 0);
        } else {
            this.start = startLineOrStart;
            this.end = startCharOrEnd as Position;
        }
    }
}

export class Uri {
    private constructor(public readonly fsPath: string) {}
    static file(p: string): Uri {
        return new Uri(p);
    }
    static parse(s: string): Uri {
        if (s.startsWith('file://')) {
            return new Uri(s.slice('file://'.length));
        }
        return new Uri(s);
    }
    toString(): string {
        return `file://${this.fsPath}`;
    }
}

export interface WorkspaceFolder {
    uri: Uri;
    name: string;
    index: number;
}

export interface TextDocument {
    getText(): string;
    positionAt(offset: number): Position;
}

export class FakeTextDocument implements TextDocument {
    constructor(private readonly text: string) {}
    getText(): string {
        return this.text;
    }
    positionAt(offset: number): Position {
        // Compute (line, character) from byte offset by counting newlines
        // up to `offset`. Sufficient for locator tests; not optimised.
        const slice = this.text.slice(0, offset);
        const lines = slice.split('\n');
        const line = lines.length - 1;
        const character = lines[line].length;
        return new Position(line, character);
    }
}

// ---------------- workspace + configuration ------------------------

export type ConfigStore = Record<string, unknown>;

class FakeWorkspaceConfiguration {
    constructor(private readonly store: ConfigStore) {}
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        if (key in this.store) {
            return this.store[key] as T;
        }
        return defaultValue;
    }
}

interface WorkspaceState {
    folders: WorkspaceFolder[] | undefined;
    config: ConfigStore;
}

const state: WorkspaceState = {
    folders: undefined,
    config: {},
};

export const workspace = {
    get workspaceFolders(): WorkspaceFolder[] | undefined {
        return state.folders;
    },
    getConfiguration(_section?: string): FakeWorkspaceConfiguration {
        return new FakeWorkspaceConfiguration(state.config);
    },
};

export interface OutputChannel {
    appendLine(value: string): void;
    append(value: string): void;
    dispose(): void;
}

export class FakeOutputChannel implements OutputChannel {
    public readonly lines: string[] = [];
    appendLine(value: string): void {
        this.lines.push(value);
    }
    append(value: string): void {
        this.lines.push(value);
    }
    dispose(): void {
        // no-op
    }
}

// ---------------- test helpers (not part of the vscode API) --------

export const __test = {
    setWorkspaceFolders(folders: WorkspaceFolder[] | undefined): void {
        state.folders = folders;
    },
    setConfig(config: ConfigStore): void {
        state.config = { ...config };
    },
    reset(): void {
        state.folders = undefined;
        state.config = {};
    },
    folder(fsPath: string, name = 'fixture', index = 0): WorkspaceFolder {
        return { uri: Uri.file(fsPath), name, index };
    },
};

export interface Disposable {
    dispose(): void;
}

// ---------------- TreeItem / ThemeIcon / ThemeColor ----------------
//
// Minimal shims so util/hints.ts (which mutates `iconPath` with a new
// ThemeIcon possibly tinted by a ThemeColor) is exercisable from the
// tier-1 tests without a real VS Code host. The mock TreeItem stores
// label / collapsibleState verbatim and exposes an `iconPath` slot
// that ThemeIcon instances can be assigned to.

export class ThemeColor {
    constructor(public readonly id: string) {}
}

export class ThemeIcon {
    constructor(
        public readonly id: string,
        public readonly color?: ThemeColor,
    ) {}
}

export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2,
}

export class TreeItem {
    public iconPath: ThemeIcon | undefined = undefined;
    public contextValue: string | undefined = undefined;
    constructor(
        public label: string,
        public collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None,
    ) {}
}

// ---------------- Diagnostics + Code Actions (Phase 2.5c) -----------

export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3,
}

export class Diagnostic {
    public source: string | undefined = undefined;
    public code: string | number | { value: string | number; target: Uri } | undefined = undefined;
    constructor(
        public range: Range,
        public message: string,
        public severity: DiagnosticSeverity = DiagnosticSeverity.Error,
    ) {}
}

export class CodeActionKind {
    static readonly QuickFix = new CodeActionKind('quickfix');
    static readonly Refactor = new CodeActionKind('refactor');
    constructor(public readonly value: string) {}
}

export class CodeAction {
    public command: { command: string; title: string; arguments?: unknown[] } | undefined;
    public diagnostics: Diagnostic[] | undefined;
    public isPreferred: boolean | undefined;
    public edit: WorkspaceEdit | undefined;
    constructor(public title: string, public kind?: CodeActionKind) {}
}

export interface CodeActionContext {
    diagnostics: readonly Diagnostic[];
    only?: CodeActionKind;
    triggerKind?: number;
}

export class Selection extends Range {}

export class CancellationTokenSource {
    public token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
    cancel(): void { this.token.isCancellationRequested = true; }
    dispose(): void {}
}

// ---------------- WorkspaceEdit ------------------------------------

export interface WorkspaceEditOp {
    kind: 'replace' | 'insert' | 'createFile';
    uri: Uri;
    range?: Range;
    position?: Position;
    text?: string;
    options?: { overwrite?: boolean; ignoreIfExists?: boolean };
}

export class WorkspaceEdit {
    public readonly ops: WorkspaceEditOp[] = [];
    replace(uri: Uri, range: Range, text: string): void {
        this.ops.push({ kind: 'replace', uri, range, text });
    }
    insert(uri: Uri, position: Position, text: string): void {
        this.ops.push({ kind: 'insert', uri, position, text });
    }
    createFile(uri: Uri, options?: { overwrite?: boolean; ignoreIfExists?: boolean }): void {
        this.ops.push({ kind: 'createFile', uri, options });
    }
}


