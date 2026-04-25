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
