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
    readonly scheme: string;
    readonly path: string;
    readonly fsPath: string;

    private constructor(scheme: string, path: string) {
        this.scheme = scheme;
        this.path = path;
        this.fsPath = path;
    }
    static file(p: string): Uri {
        return new Uri('file', p);
    }
    static parse(s: string): Uri {
        const colon = s.indexOf(':');
        if (colon > 0) {
            const scheme = s.slice(0, colon);
            let rest = s.slice(colon + 1);
            if (rest.startsWith('//')) { rest = rest.slice(2); }
            return new Uri(scheme, rest);
        }
        return new Uri('file', s);
    }
    toString(): string {
        if (this.scheme === 'file') { return `file://${this.path}`; }
        return `${this.scheme}:${this.path}`;
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
    trusted: boolean;
}

const state: WorkspaceState = {
    folders: undefined,
    config: {},
    trusted: true,
};

// ---------------- workspace + configuration change events ----------

type ConfigChangeListener = (e: { affectsConfiguration: (key: string) => boolean }) => void;
const configChangeListeners: ConfigChangeListener[] = [];

type TrustListener = () => void;
const trustListeners: TrustListener[] = [];

export const workspace = {
    get isTrusted(): boolean {
        return state.trusted;
    },
    get workspaceFolders(): WorkspaceFolder[] | undefined {
        return state.folders;
    },
    getConfiguration(_section?: string): FakeWorkspaceConfiguration {
        return new FakeWorkspaceConfiguration(state.config);
    },
    onDidChangeConfiguration(listener: ConfigChangeListener): Disposable {
        configChangeListeners.push(listener);
        return {
            dispose(): void {
                const i = configChangeListeners.indexOf(listener);
                if (i >= 0) {
                    configChangeListeners.splice(i, 1);
                }
            },
        };
    },
    onDidGrantWorkspaceTrust(listener: TrustListener): Disposable {
        trustListeners.push(listener);
        return {
            dispose(): void {
                const idx = trustListeners.indexOf(listener);
                if (idx >= 0) { trustListeners.splice(idx, 1); }
            },
        };
    },
    /** Fake openTextDocument: returns a FakeTextDocument with the content
     *  set via __test.setDocumentContent(), or empty if unset. */
    async openTextDocument(_uri: unknown): Promise<TextDocument> {
        return new FakeTextDocument(documentState.content);
    },
};

// ---------------- status bar / window / commands -------------------

export enum StatusBarAlignment {
    Left = 1,
    Right = 2,
}

export class MarkdownString {
    public value = '';
    public isTrusted = false;
    public supportHtml = false;
    constructor(value?: string, _supportThemeIcons?: boolean) {
        this.value = value ?? '';
    }
    appendMarkdown(s: string): MarkdownString {
        this.value += s;
        return this;
    }
}

export interface StatusBarItem {
    text: string;
    name?: string;
    tooltip?: string | MarkdownString;
    command?: string | { command: string; title: string };
    backgroundColor?: ThemeColor;
    show(): void;
    hide(): void;
    dispose(): void;
}

export class FakeStatusBarItem implements StatusBarItem {
    public text = '';
    public name?: string;
    public tooltip?: string | MarkdownString;
    public command?: string | { command: string; title: string };
    public backgroundColor?: ThemeColor;
    public visible = false;
    show(): void { this.visible = true; }
    hide(): void { this.visible = false; }
    dispose(): void { this.visible = false; }
}

interface WindowMessageRecord {
    kind: 'info' | 'warning' | 'error';
    message: string;
    items: string[];
}
const windowState = {
    messages: [] as WindowMessageRecord[],
    /** Next answer to return from any show*Message call. */
    nextChoice: undefined as string | undefined,
    statusBarItems: [] as FakeStatusBarItem[],
};

export const window = {
    createStatusBarItem(_alignment?: StatusBarAlignment, _priority?: number): FakeStatusBarItem {
        const item = new FakeStatusBarItem();
        windowState.statusBarItems.push(item);
        return item;
    },
    createOutputChannel(_name: string): FakeOutputChannel {
        return new FakeOutputChannel();
    },
    showInformationMessage(message: string, ...items: unknown[]): Promise<string | undefined> {
        const labels = items.filter((i): i is string => typeof i === 'string');
        windowState.messages.push({ kind: 'info', message, items: labels });
        return Promise.resolve(windowState.nextChoice);
    },
    showWarningMessage(message: string, ...items: unknown[]): Promise<string | undefined> {
        const labels: string[] = [];
        for (const item of items) {
            if (typeof item === 'string') {
                labels.push(item);
            }
            // Skip the modal options bag: { modal: true, ... }
        }
        windowState.messages.push({ kind: 'warning', message, items: labels });
        return Promise.resolve(windowState.nextChoice);
    },
    showErrorMessage(message: string, ...items: unknown[]): Promise<string | undefined> {
        const labels = items.filter((i): i is string => typeof i === 'string');
        windowState.messages.push({ kind: 'error', message, items: labels });
        return Promise.resolve(windowState.nextChoice);
    },
};

const commandRegistry = new Map<string, (...args: unknown[]) => unknown>();
const commandInvocations: Array<{ command: string; args: unknown[] }> = [];

export const commands = {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable {
        commandRegistry.set(id, handler);
        return {
            dispose(): void {
                const current = commandRegistry.get(id);
                if (current === handler) {
                    commandRegistry.delete(id);
                }
            },
        };
    },
    executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
        commandInvocations.push({ command: id, args });
        const handler = commandRegistry.get(id);
        if (!handler) {
            return Promise.resolve(undefined);
        }
        return Promise.resolve(handler(...args));
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
        state.trusted = true;
        configChangeListeners.length = 0;
        trustListeners.length = 0;
        windowState.messages.length = 0;
        windowState.nextChoice = undefined;
        windowState.statusBarItems.length = 0;
        commandRegistry.clear();
        commandInvocations.length = 0;
        lmState.models = [];
        documentState.content = '';
        languagesState.collections.length = 0;
    },
    setTrusted(trusted: boolean): void {
        state.trusted = trusted;
    },
    /** Install fake language models visible to `vscode.lm.selectChatModels`. */
    setLmModels(models: FakeLanguageModelChat[]): void {
        lmState.models = [...models];
    },
    /** Build a fake LanguageModelChat that returns `response` from `sendRequest`. */
    fakeModel(
        response: string,
        id = 'test-model',
        family = 'test-family',
    ): FakeLanguageModelChat {
        return {
            id,
            family,
            async sendRequest() {
                return {
                    text: (async function* () {
                        yield response;
                    })(),
                };
            },
        };
    },
    folder(fsPath: string, name = 'fixture', index = 0): WorkspaceFolder {
        return { uri: Uri.file(fsPath), name, index };
    },
    /** Set the answer the next show*Message call will resolve with. */
    setNextChoice(choice: string | undefined): void {
        windowState.nextChoice = choice;
    },
    /** All show*Message calls captured since the last reset. */
    messages(): ReadonlyArray<{ kind: 'info' | 'warning' | 'error'; message: string; items: string[] }> {
        return windowState.messages;
    },
    statusBarItems(): ReadonlyArray<FakeStatusBarItem> {
        return windowState.statusBarItems;
    },
    commandInvocations(): ReadonlyArray<{ command: string; args: unknown[] }> {
        return commandInvocations;
    },
    fireConfigChange(affected: ReadonlyArray<string>): void {
        const event = {
            affectsConfiguration: (key: string) => affected.some(a => a === key || a.startsWith(key + '.')),
        };
        for (const l of [...configChangeListeners]) {
            l(event);
        }
    },
    /** Set the content returned by workspace.openTextDocument(). */
    setDocumentContent(content: string): void {
        documentState.content = content;
    },
    /** All diagnostic collections created via languages.createDiagnosticCollection(). */
    diagnosticCollections(): ReadonlyArray<FakeDiagnosticCollection> {
        return languagesState.collections;
    },
};

export interface Disposable {
    dispose(): void;
}

// ---------------- EventEmitter -------------------------------------

export class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    readonly event = (listener: (e: T) => void): Disposable => {
        this.listeners.push(listener);
        return {
            dispose: () => {
                const idx = this.listeners.indexOf(listener);
                if (idx >= 0) { this.listeners.splice(idx, 1); }
            },
        };
    };
    fire(data: T): void {
        for (const l of [...this.listeners]) { l(data); }
    }
    dispose(): void { this.listeners.length = 0; }
}

// ---------------- Language Model (vscode.lm) -----------------------

export class LanguageModelChatMessage {
    constructor(public readonly role: string, public readonly content: string) {}
    static User(content: string): LanguageModelChatMessage {
        return new LanguageModelChatMessage('user', content);
    }
    static Assistant(content: string): LanguageModelChatMessage {
        return new LanguageModelChatMessage('assistant', content);
    }
}

interface FakeLanguageModelChat {
    id: string;
    family: string;
    sendRequest(
        messages: LanguageModelChatMessage[],
        options?: Record<string, unknown>,
        token?: unknown,
    ): Promise<{ text: AsyncIterable<string> }>;
}

const lmState: { models: FakeLanguageModelChat[] } = { models: [] };

type LmChangeListener = () => void;
const lmChangeListeners: LmChangeListener[] = [];

export const lm = {
    async selectChatModels(
        selector?: { family?: string },
    ): Promise<FakeLanguageModelChat[]> {
        if (selector?.family) {
            return lmState.models.filter((m) => m.family === selector.family);
        }
        return [...lmState.models];
    },
    onDidChangeChatModels(listener: LmChangeListener): Disposable {
        lmChangeListeners.push(listener);
        return {
            dispose(): void {
                const idx = lmChangeListeners.indexOf(listener);
                if (idx >= 0) { lmChangeListeners.splice(idx, 1); }
            },
        };
    },
};

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

// ---------------- Document state (for openTextDocument mock) --------

const documentState = {
    content: '',
};

// ---------------- Languages (diagnostics) --------------------------

/** In-memory diagnostic collection for testing. */
export class FakeDiagnosticCollection {
    public readonly name: string;
    private readonly entries = new Map<string, Diagnostic[]>();
    constructor(name: string) {
        this.name = name;
        languagesState.collections.push(this);
    }
    set(uri: Uri, diagnostics: Diagnostic[]): void {
        this.entries.set(uri.fsPath, [...diagnostics]);
    }
    get(uri: Uri): Diagnostic[] | undefined {
        return this.entries.get(uri.fsPath);
    }
    has(uri: Uri): boolean {
        return this.entries.has(uri.fsPath);
    }
    delete(uri: Uri): void {
        this.entries.delete(uri.fsPath);
    }
    clear(): void {
        this.entries.clear();
    }
    forEach(callback: (uri: Uri, diagnostics: Diagnostic[]) => void): void {
        for (const [fsPath, diags] of this.entries) {
            callback(Uri.file(fsPath), diags);
        }
    }
    dispose(): void {
        this.entries.clear();
    }
}

const languagesState = {
    collections: [] as FakeDiagnosticCollection[],
};

export const languages = {
    createDiagnosticCollection(name: string): FakeDiagnosticCollection {
        return new FakeDiagnosticCollection(name);
    },
};


