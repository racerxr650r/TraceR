// Fake sidecar client for provider-level integration tests.
//
// Implements the same public async methods as ProjectIoClient without
// spawning a Python process. Each method resolves with a canned
// response that can be set per-test via the `.responses` bag. Methods
// that haven't been configured reject with a descriptive error so
// missing setup is obvious.
//
// Usage:
//   const sidecar = new FakeSidecarClient();
//   sidecar.responses.lint = { errors: [], warnings: [], notes: [], items: [], ok: true };
//   const provider = new LintDiagnosticsProvider(sidecar as any, channel);

import type {
    AiRequestParams,
    AiRequestResult,
    ApplyEditParams,
    ApplyEditResult,
    ApplyMergeResolutionParams,
    ApplyMergeResolutionResult,
    FormSchemaParams,
    FormSchemaResult,
    InitProjectParams,
    InitProjectResult,
    LintResult,
    ListDocumentsResult,
    MergeThreeWayParams,
    MergeThreeWayResult,
    NextFreeIdParams,
    ParsedProject,
    RenderParams,
    RenderResult,
    UiHintsIndexResult,
} from '../../../src/sidecar';

/** Bag of canned responses. Set the ones your test needs. */
export interface FakeSidecarResponses {
    lint?: LintResult | Error;
    parseToJson?: ParsedProject | Error;
    listDocuments?: ListDocumentsResult | Error;
    uiHintsIndex?: UiHintsIndexResult | Error;
    render?: RenderResult | Error;
    applyEdit?: ApplyEditResult | Error;
    formSchema?: FormSchemaResult | Error;
    nextFreeId?: { id: string } | Error;
    initProject?: InitProjectResult | Error;
    aiRequest?: AiRequestResult | Error;
    mergeThreeWay?: MergeThreeWayResult | Error;
    applyMergeResolution?: ApplyMergeResolutionResult | Error;
}

/** Call log entry for verifying which sidecar methods were invoked. */
export interface SidecarCall {
    method: string;
    params: unknown;
}

function resolve<T>(name: string, value: T | Error | undefined): Promise<T> {
    if (value === undefined) {
        return Promise.reject(new Error(`FakeSidecarClient: no canned response for '${name}'`));
    }
    if (value instanceof Error) {
        return Promise.reject(value);
    }
    return Promise.resolve(value);
}

export class FakeSidecarClient {
    readonly responses: FakeSidecarResponses = {};
    readonly calls: SidecarCall[] = [];

    private log(method: string, params: unknown): void {
        this.calls.push({ method, params });
    }

    async lint(params: Record<string, unknown> = {}): Promise<LintResult> {
        this.log('lint', params);
        return resolve('lint', this.responses.lint);
    }

    async parseToJson(params: Record<string, unknown> = {}): Promise<ParsedProject> {
        this.log('parseToJson', params);
        return resolve('parseToJson', this.responses.parseToJson);
    }

    async listDocuments(params: Record<string, unknown> = {}): Promise<ListDocumentsResult> {
        this.log('listDocuments', params);
        return resolve('listDocuments', this.responses.listDocuments);
    }

    async uiHintsIndex(params: Record<string, unknown> = {}): Promise<UiHintsIndexResult> {
        this.log('uiHintsIndex', params);
        return resolve('uiHintsIndex', this.responses.uiHintsIndex);
    }

    async render(params: RenderParams): Promise<RenderResult> {
        this.log('render', params);
        return resolve('render', this.responses.render);
    }

    async applyEdit(params: ApplyEditParams): Promise<ApplyEditResult> {
        this.log('applyEdit', params);
        return resolve('applyEdit', this.responses.applyEdit);
    }

    async formSchema(params: FormSchemaParams): Promise<FormSchemaResult> {
        this.log('formSchema', params);
        return resolve('formSchema', this.responses.formSchema);
    }

    async nextFreeId(params: NextFreeIdParams): Promise<{ id: string }> {
        this.log('nextFreeId', params);
        return resolve('nextFreeId', this.responses.nextFreeId);
    }

    async initProject(params: InitProjectParams): Promise<InitProjectResult> {
        this.log('initProject', params);
        return resolve('initProject', this.responses.initProject);
    }

    async aiRequest(params: AiRequestParams): Promise<AiRequestResult> {
        this.log('aiRequest', params);
        return resolve('aiRequest', this.responses.aiRequest);
    }

    async mergeThreeWay(params: MergeThreeWayParams): Promise<MergeThreeWayResult> {
        this.log('mergeThreeWay', params);
        return resolve('mergeThreeWay', this.responses.mergeThreeWay);
    }

    async applyMergeResolution(params: ApplyMergeResolutionParams): Promise<ApplyMergeResolutionResult> {
        this.log('applyMergeResolution', params);
        return resolve('applyMergeResolution', this.responses.applyMergeResolution);
    }

    /** Reset calls and responses between tests. */
    reset(): void {
        this.calls.length = 0;
        for (const key of Object.keys(this.responses) as (keyof FakeSidecarResponses)[]) {
            delete this.responses[key];
        }
    }

    dispose(): void {
        // no-op — nothing to clean up
    }
}
