// Unit tests for the gap.fix AI flow through AiClient.
//
// Mocks the sidecar (aiRequest) and the language model to exercise the
// full pipeline: prepare → model → validate without touching a real
// Python process or language model provider.
//
// Traces: HLR-051, HLR-029, HLR-032

import { strict as assert } from 'assert';
import type * as vscode from 'vscode';
import { __test, FakeOutputChannel } from './__mocks__/vscode';
import { AiClient, RunIntentOutcome } from '../../src/ai/AiClient';
import { AiCapabilityProvider } from '../../src/ai/capabilities';
import type { AiRequestParams, AiRequestResult, AiTarget, ProjectIoClient } from '../../src/sidecar';

// ── Helpers ──────────────────────────────────────────────────────

const TARGET: AiTarget = { type: 'Hlr', id: 'HLR-T02' };

const SYSTEM_PROMPT = 'You are a gap-fixer. Add an LLR for HLR-T02.';
const MODEL_RESPONSE = '{"id":"LLR-NEW-01","text":"Covers HLR-T02.","traces":[{"target":"HLR","ref":"HLR-T02"}]}';

/** Minimal fake sidecar that responds to aiRequest for the gap.fix
 *  prepare → evaluate flow. */
function fakeSidecar(opts?: {
    evaluationKind?: AiRequestResult['kind'];
    retryFeedback?: string[];
}): ProjectIoClient {
    const kind = opts?.evaluationKind ?? 'validated';
    const retryFeedback = opts?.retryFeedback;
    let callCount = 0;
    return {
        aiRequest(params: AiRequestParams): Promise<AiRequestResult> {
            callCount++;
            // First call (no model_response) → prepare step: return prompt.
            if (!params.model_response) {
                return Promise.resolve({
                    kind: 'prompt',
                    intent: params.intent,
                    target: params.target,
                    retries: 0,
                    prompt: SYSTEM_PROMPT,
                });
            }
            // Second+ call (with model_response) → evaluate step.
            return Promise.resolve({
                kind,
                intent: params.intent,
                target: params.target,
                retries: params.retry_count ?? 0,
                patch: kind === 'validated' ? [{ op: 'add', path: '/llrs/function/llr', value: {} }] : undefined,
                written: params.write ?? false,
                retry_feedback: retryFeedback,
            });
        },
    } as unknown as ProjectIoClient;
}

describe('ai/AiClient — gap.fix flow', () => {
    let output: FakeOutputChannel;

    beforeEach(() => {
        __test.reset();
        __test.setTrusted(true);
        __test.setConfig({ 'ai.enabled': true, 'ai.modelFamily': '' });
        __test.setLmModels([__test.fakeModel(MODEL_RESPONSE)]);
        output = new FakeOutputChannel();
    });

    afterEach(() => {
        __test.reset();
    });

    it('completes the prepare → model → validate pipeline (validated)', async () => {
        const sidecar = fakeSidecar({ evaluationKind: 'validated' });
        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        await caps.refresh();
        const client = new AiClient(sidecar, caps, output as unknown as vscode.OutputChannel);

        const outcome: RunIntentOutcome = await client.runIntent({
            intent: 'gap.fix',
            target: TARGET,
            userPrompt: 'Add an LLR for HLR-T02.',
        });

        assert.equal(outcome.result.kind, 'validated');
        assert.equal(outcome.modelId, 'test-model');
        assert.equal(outcome.pendingApply, true, 'patch should be pending apply');
        assert.ok(outcome.rawResponse, 'raw model response should be captured');
        assert.ok(outcome.systemPrompt, 'system prompt should be captured');
    });

    it('returns applied when sidecar writes immediately', async () => {
        const sidecar = fakeSidecar({ evaluationKind: 'applied' });
        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        await caps.refresh();
        const client = new AiClient(sidecar, caps, output as unknown as vscode.OutputChannel);

        const outcome = await client.runIntent({
            intent: 'gap.fix',
            target: TARGET,
            userPrompt: 'Add an LLR for HLR-T02.',
            autoApply: true,
        });

        assert.equal(outcome.result.kind, 'applied');
        assert.equal(outcome.pendingApply, false);
    });

    it('returns no-model when no language model is available', async () => {
        __test.setLmModels([]);
        const sidecar = fakeSidecar();
        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        await caps.refresh();
        // Even though caps says no-model, requireAvailable() will throw.
        // AiClient should handle this case. Let's make caps think it's
        // available by re-adding a model for the capability check then
        // removing it before AiClient.pickModel() runs.
        __test.setLmModels([__test.fakeModel('dummy')]);
        await caps.refresh();
        __test.setLmModels([]); // remove before pickModel runs
        const client = new AiClient(sidecar, caps, output as unknown as vscode.OutputChannel);

        const outcome = await client.runIntent({
            intent: 'gap.fix',
            target: TARGET,
            userPrompt: 'Add an LLR for HLR-T02.',
        });

        assert.equal(outcome.result.kind, 'no-model');
        assert.equal(outcome.pendingApply, false);
    });

    it('retries once on rejected with retry_feedback', async () => {
        let evalCalls = 0;
        const sidecar = {
            aiRequest(params: AiRequestParams): Promise<AiRequestResult> {
                if (!params.model_response) {
                    return Promise.resolve({
                        kind: 'prompt' as const,
                        intent: params.intent,
                        target: params.target,
                        retries: 0,
                        prompt: SYSTEM_PROMPT,
                    });
                }
                evalCalls++;
                if (evalCalls === 1) {
                    // First evaluation: reject with retry feedback
                    return Promise.resolve({
                        kind: 'rejected' as const,
                        intent: params.intent,
                        target: params.target,
                        retries: 0,
                        retry_feedback: ['The id must start with LLR-UT prefix.'],
                    });
                }
                // Second evaluation (after retry): validated
                return Promise.resolve({
                    kind: 'validated' as const,
                    intent: params.intent,
                    target: params.target,
                    retries: 1,
                    patch: [{ op: 'add', path: '/llrs/function/llr', value: {} }],
                    written: false,
                });
            },
        } as unknown as ProjectIoClient;

        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        await caps.refresh();
        const client = new AiClient(sidecar, caps, output as unknown as vscode.OutputChannel);

        const outcome = await client.runIntent({
            intent: 'gap.fix',
            target: TARGET,
            userPrompt: 'Add an LLR for HLR-T02.',
        });

        assert.equal(outcome.result.kind, 'validated');
        assert.equal(outcome.result.retries, 1);
        assert.equal(evalCalls, 2, 'sidecar should have been called twice for evaluation');
    });

    it('retries when evaluate returns kind=prompt with retry_feedback', async () => {
        // This is the scenario where the Python sidecar signals a retry
        // via kind="prompt" + retry_feedback (not kind="rejected").
        let evalCalls = 0;
        const sidecar = {
            aiRequest(params: AiRequestParams): Promise<AiRequestResult> {
                if (!params.model_response) {
                    return Promise.resolve({
                        kind: 'prompt' as const,
                        intent: params.intent,
                        target: params.target,
                        retries: 0,
                        prompt: SYSTEM_PROMPT,
                    });
                }
                evalCalls++;
                if (evalCalls === 1) {
                    // First evaluation: sidecar returns kind=prompt + retry_feedback
                    return Promise.resolve({
                        kind: 'prompt' as const,
                        intent: params.intent,
                        target: params.target,
                        retries: 0,
                        prompt: SYSTEM_PROMPT,
                        retry_feedback: ['JSON schema validation failed: missing "id" field.'],
                    });
                }
                // Second evaluation (after retry): validated
                return Promise.resolve({
                    kind: 'validated' as const,
                    intent: params.intent,
                    target: params.target,
                    retries: 1,
                    patch: [{ op: 'add', path: '/llrs/function/llr', value: {} }],
                    written: false,
                });
            },
        } as unknown as ProjectIoClient;

        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        await caps.refresh();
        const client = new AiClient(sidecar, caps, output as unknown as vscode.OutputChannel);

        const outcome = await client.runIntent({
            intent: 'gap.fix',
            target: TARGET,
            userPrompt: 'Add an LLR for HLR-T02.',
        });

        assert.equal(outcome.result.kind, 'validated');
        assert.equal(outcome.result.retries, 1);
        assert.equal(evalCalls, 2, 'should have retried on kind=prompt with retry_feedback');
    });

    it('normalizes lingering kind=prompt to rejected after exhausting retries', async () => {
        // If the retry also returns kind=prompt, normalize to rejected.
        const sidecar = {
            aiRequest(params: AiRequestParams): Promise<AiRequestResult> {
                if (!params.model_response) {
                    return Promise.resolve({
                        kind: 'prompt' as const,
                        intent: params.intent,
                        target: params.target,
                        retries: 0,
                        prompt: SYSTEM_PROMPT,
                    });
                }
                // Always returns kind=prompt + retry_feedback
                return Promise.resolve({
                    kind: 'prompt' as const,
                    intent: params.intent,
                    target: params.target,
                    retries: params.retry_count ?? 0,
                    prompt: SYSTEM_PROMPT,
                    retry_feedback: ['Still invalid.'],
                });
            },
        } as unknown as ProjectIoClient;

        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        await caps.refresh();
        const client = new AiClient(sidecar, caps, output as unknown as vscode.OutputChannel);

        const outcome = await client.runIntent({
            intent: 'gap.fix',
            target: TARGET,
            userPrompt: 'Add an LLR for HLR-T02.',
        });

        // Should be normalized to 'rejected' instead of leaking 'prompt'
        assert.equal(outcome.result.kind, 'rejected');
        assert.ok(outcome.result.failures?.length, 'should have failure messages');
    });

    it('stays rejected when retry also fails', async () => {
        const sidecar = {
            aiRequest(params: AiRequestParams): Promise<AiRequestResult> {
                if (!params.model_response) {
                    return Promise.resolve({
                        kind: 'prompt' as const,
                        intent: params.intent,
                        target: params.target,
                        retries: 0,
                        prompt: SYSTEM_PROMPT,
                    });
                }
                // Always reject
                return Promise.resolve({
                    kind: 'rejected' as const,
                    intent: params.intent,
                    target: params.target,
                    retries: params.retry_count ?? 0,
                    failures: ['Invalid JSON'],
                    retry_feedback: (params.retry_count ?? 0) < 1
                        ? ['Please output valid JSON.']
                        : undefined,
                });
            },
        } as unknown as ProjectIoClient;

        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        await caps.refresh();
        const client = new AiClient(sidecar, caps, output as unknown as vscode.OutputChannel);

        const outcome = await client.runIntent({
            intent: 'gap.fix',
            target: TARGET,
            userPrompt: 'Add an LLR for HLR-T02.',
        });

        assert.equal(outcome.result.kind, 'rejected');
    });

    it('throws when AI is unavailable (untrusted workspace)', async () => {
        __test.setTrusted(false);
        const sidecar = fakeSidecar();
        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        await caps.refresh();
        const client = new AiClient(sidecar, caps, output as unknown as vscode.OutputChannel);

        await assert.rejects(
            () => client.runIntent({
                intent: 'gap.fix',
                target: TARGET,
                userPrompt: 'Add an LLR.',
            }),
            (err: Error & { code?: string }) => {
                assert.match(err.message, /untrusted/i);
                return true;
            },
        );
    });

    it('passes lint_findings through to the sidecar', async () => {
        const capturedParams: AiRequestParams[] = [];
        const sidecar = {
            aiRequest(params: AiRequestParams): Promise<AiRequestResult> {
                capturedParams.push(params);
                if (!params.model_response) {
                    return Promise.resolve({
                        kind: 'prompt' as const,
                        intent: params.intent,
                        target: params.target,
                        retries: 0,
                        prompt: SYSTEM_PROMPT,
                    });
                }
                return Promise.resolve({
                    kind: 'validated' as const,
                    intent: params.intent,
                    target: params.target,
                    retries: 0,
                    patch: [],
                    written: false,
                });
            },
        } as unknown as ProjectIoClient;

        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        await caps.refresh();
        const client = new AiClient(sidecar, caps, output as unknown as vscode.OutputChannel);
        const findings = [{ code: 'gap-hlr', severity: 'warning', message: 'HLR-T02 has no LLR' }];

        await client.runIntent({
            intent: 'gap.fix',
            target: TARGET,
            userPrompt: 'Fix the gap.',
            lintFindings: findings,
        });

        // Both prepare and evaluate calls should carry lint_findings
        assert.ok(capturedParams.length >= 2, 'expected at least 2 sidecar calls');
        assert.deepEqual(capturedParams[0].lint_findings, findings);
        assert.deepEqual(capturedParams[1].lint_findings, findings);
    });
});

describe('ai/AiCapabilityProvider', () => {
    let output: FakeOutputChannel;

    beforeEach(() => {
        __test.reset();
        output = new FakeOutputChannel();
    });

    afterEach(() => {
        __test.reset();
    });

    it('evaluates available when trusted + enabled + model present', async () => {
        __test.setTrusted(true);
        __test.setConfig({ 'ai.enabled': true });
        __test.setLmModels([__test.fakeModel('response')]);
        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        const state = await caps.refresh();
        assert.equal(state.available, true);
        caps.dispose();
    });

    it('evaluates unavailable when workspace is untrusted', async () => {
        __test.setTrusted(false);
        __test.setConfig({ 'ai.enabled': true });
        __test.setLmModels([__test.fakeModel('response')]);
        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        const state = await caps.refresh();
        assert.equal(state.available, false);
        assert.equal(state.reason, 'untrusted');
        caps.dispose();
    });

    it('evaluates unavailable when disabled in settings', async () => {
        __test.setTrusted(true);
        __test.setConfig({ 'ai.enabled': false });
        __test.setLmModels([__test.fakeModel('response')]);
        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        const state = await caps.refresh();
        assert.equal(state.available, false);
        assert.equal(state.reason, 'disabled');
        caps.dispose();
    });

    it('evaluates unavailable when no models exist', async () => {
        __test.setTrusted(true);
        __test.setConfig({ 'ai.enabled': true });
        __test.setLmModels([]);
        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        const state = await caps.refresh();
        assert.equal(state.available, false);
        assert.equal(state.reason, 'no-model');
        caps.dispose();
    });

    it('requireAvailable() throws when not available', async () => {
        __test.setTrusted(true);
        __test.setConfig({ 'ai.enabled': true });
        __test.setLmModels([]);
        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        await caps.refresh();
        assert.throws(() => caps.requireAvailable(), /no language model/i);
        caps.dispose();
    });

    it('filters models by family when modelFamily is set', async () => {
        __test.setTrusted(true);
        __test.setConfig({ 'ai.enabled': true, 'ai.modelFamily': 'gpt-4o' });
        __test.setLmModels([__test.fakeModel('response', 'other-id', 'claude')]);
        const caps = new AiCapabilityProvider(output as unknown as vscode.OutputChannel);
        const state = await caps.refresh();
        // The mock's selectChatModels filters by family, so claude won't match gpt-4o
        assert.equal(state.available, false);
        assert.equal(state.reason, 'no-model');

        // Now add a model with the right family
        __test.setLmModels([__test.fakeModel('response', 'gpt-id', 'gpt-4o')]);
        const state2 = await caps.refresh();
        assert.equal(state2.available, true);
        caps.dispose();
    });
});
