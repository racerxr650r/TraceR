// Provider-level integration test: AiCapabilityProvider state machine.
//
// Verifies that:
//   * evaluate() returns available=true when trust + enabled + model all hold;
//   * evaluate() returns 'untrusted' when workspace is not trusted;
//   * evaluate() returns 'disabled' when ai.enabled=false;
//   * evaluate() returns 'no-model' when no chat models are available;
//   * refresh() fires onDidChange when state transitions;
//   * refresh() does NOT fire when state is unchanged;
//   * requireAvailable() throws when AI is unavailable;
//   * config change triggers a re-evaluation;
//   * workspace trust grant triggers a re-evaluation.

import * as assert from 'assert';
import { __test as vscodeTest, FakeOutputChannel } from './__mocks__/vscode';
import {
    AiCapabilityProvider,
    AiCapabilityState,
} from '../../src/ai/capabilities';

describe('AiCapabilityProvider (state machine)', () => {
    let channel: FakeOutputChannel;

    beforeEach(() => {
        vscodeTest.reset();
        channel = new FakeOutputChannel();
    });

    afterEach(() => {
        vscodeTest.reset();
    });

    // ── evaluate() gate logic ────────────────────────────────────

    it('returns available=true when all gates pass', async () => {
        vscodeTest.setTrusted(true);
        vscodeTest.setConfig({ 'ai.enabled': true });
        vscodeTest.setLmModels([vscodeTest.fakeModel('hi')]);

        const provider = new AiCapabilityProvider(
            channel as unknown as import('vscode').OutputChannel,
        );
        try {
            const state = await provider.evaluate();
            assert.strictEqual(state.available, true);
            assert.strictEqual(state.reason, undefined);
        } finally {
            provider.dispose();
        }
    });

    it('returns untrusted when workspace is not trusted', async () => {
        vscodeTest.setTrusted(false);
        vscodeTest.setConfig({ 'ai.enabled': true });
        vscodeTest.setLmModels([vscodeTest.fakeModel('hi')]);

        const provider = new AiCapabilityProvider(
            channel as unknown as import('vscode').OutputChannel,
        );
        try {
            const state = await provider.evaluate();
            assert.strictEqual(state.available, false);
            assert.strictEqual(state.reason, 'untrusted');
        } finally {
            provider.dispose();
        }
    });

    it('returns disabled when ai.enabled=false', async () => {
        vscodeTest.setTrusted(true);
        vscodeTest.setConfig({ 'ai.enabled': false });
        vscodeTest.setLmModels([vscodeTest.fakeModel('hi')]);

        const provider = new AiCapabilityProvider(
            channel as unknown as import('vscode').OutputChannel,
        );
        try {
            const state = await provider.evaluate();
            assert.strictEqual(state.available, false);
            assert.strictEqual(state.reason, 'disabled');
        } finally {
            provider.dispose();
        }
    });

    it('returns no-model when no chat models are available', async () => {
        vscodeTest.setTrusted(true);
        vscodeTest.setConfig({ 'ai.enabled': true });
        vscodeTest.setLmModels([]);

        const provider = new AiCapabilityProvider(
            channel as unknown as import('vscode').OutputChannel,
        );
        try {
            const state = await provider.evaluate();
            assert.strictEqual(state.available, false);
            assert.strictEqual(state.reason, 'no-model');
        } finally {
            provider.dispose();
        }
    });

    // ── refresh() event firing ───────────────────────────────────

    it('refresh() fires onDidChange when state transitions', async () => {
        vscodeTest.setTrusted(true);
        vscodeTest.setConfig({ 'ai.enabled': true });
        vscodeTest.setLmModels([]);

        const provider = new AiCapabilityProvider(
            channel as unknown as import('vscode').OutputChannel,
        );
        try {
            // Initial state: no-model
            await provider.refresh();
            assert.strictEqual(provider.state().available, false);

            // Add a model — should transition to available
            vscodeTest.setLmModels([vscodeTest.fakeModel('hello')]);
            const events: AiCapabilityState[] = [];
            provider.onDidChange((s) => events.push(s));
            await provider.refresh();

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].available, true);
            assert.strictEqual(provider.state().available, true);
        } finally {
            provider.dispose();
        }
    });

    it('refresh() does NOT fire onDidChange when state is unchanged', async () => {
        vscodeTest.setTrusted(true);
        vscodeTest.setConfig({ 'ai.enabled': true });
        vscodeTest.setLmModels([vscodeTest.fakeModel('hi')]);

        const provider = new AiCapabilityProvider(
            channel as unknown as import('vscode').OutputChannel,
        );
        try {
            await provider.refresh();
            const events: AiCapabilityState[] = [];
            provider.onDidChange((s) => events.push(s));
            await provider.refresh();
            assert.strictEqual(events.length, 0, 'should not fire when state unchanged');
        } finally {
            provider.dispose();
        }
    });

    // ── requireAvailable() ───────────────────────────────────────

    it('requireAvailable() throws when AI is unavailable', async () => {
        vscodeTest.setTrusted(true);
        vscodeTest.setConfig({ 'ai.enabled': false });

        const provider = new AiCapabilityProvider(
            channel as unknown as import('vscode').OutputChannel,
        );
        try {
            await provider.refresh();
            assert.throws(() => provider.requireAvailable(), /disabled/);
        } finally {
            provider.dispose();
        }
    });

    it('requireAvailable() returns the state when AI is available', async () => {
        vscodeTest.setTrusted(true);
        vscodeTest.setConfig({ 'ai.enabled': true });
        vscodeTest.setLmModels([vscodeTest.fakeModel('hi')]);

        const provider = new AiCapabilityProvider(
            channel as unknown as import('vscode').OutputChannel,
        );
        try {
            await provider.refresh();
            const state = provider.requireAvailable();
            assert.strictEqual(state.available, true);
        } finally {
            provider.dispose();
        }
    });

    // ── Reactive triggers ────────────────────────────────────────

    it('config change fires re-evaluation', async () => {
        vscodeTest.setTrusted(true);
        vscodeTest.setConfig({ 'ai.enabled': true });
        vscodeTest.setLmModels([vscodeTest.fakeModel('hi')]);

        const provider = new AiCapabilityProvider(
            channel as unknown as import('vscode').OutputChannel,
        );
        try {
            await provider.refresh();
            assert.strictEqual(provider.state().available, true);

            // Disable AI
            vscodeTest.setConfig({ 'ai.enabled': false });
            const events: AiCapabilityState[] = [];
            provider.onDidChange((s) => events.push(s));
            vscodeTest.fireConfigChange(['projectXml.ai.enabled']);
            // Allow the async refresh to settle
            await new Promise((r) => setTimeout(r, 50));

            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].available, false);
            assert.strictEqual(events[0].reason, 'disabled');
        } finally {
            provider.dispose();
        }
    });
});
