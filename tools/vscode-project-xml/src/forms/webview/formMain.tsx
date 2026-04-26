// Phase 3: webview script bundled by esbuild into dist/formPanel.js.
//
// This is intentionally small: react-jsonschema-form drives the
// schema-derived form, the extension host owns derivation +
// persistence. The webview only displays the schema, captures the
// formData, and ships submit/cancel messages back.

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import type { RJSFSchema, UiSchema } from '@rjsf/utils';

declare const acquireVsCodeApi: () => {
    postMessage(msg: unknown): void;
    setState(state: unknown): void;
    getState(): unknown;
};

interface InitMessage {
    type: 'init';
    title: string;
    schema: RJSFSchema;
    uiSchema: UiSchema;
    formData: Record<string, unknown>;
}

interface ResultMessage {
    type: 'result';
    ok: boolean;
    message?: string;
    findings?: {
        errors?: string[];
        warnings?: string[];
    } | null;
}

const vscode = acquireVsCodeApi();

interface AppState {
    inited: boolean;
    title: string;
    schema: RJSFSchema;
    uiSchema: UiSchema;
    formData: Record<string, unknown>;
    pending: boolean;
    result: ResultMessage | null;
}

const initialState: AppState = {
    inited: false,
    title: 'Project Spec form',
    schema: { type: 'object' },
    uiSchema: {},
    formData: {},
    pending: false,
    result: null,
};

function App(): React.ReactElement {
    const [state, setState] = React.useState<AppState>(initialState);

    React.useEffect(() => {
        const handler = (event: MessageEvent) => {
            const msg = event.data;
            if (msg?.type === 'init') {
                const init = msg as InitMessage;
                setState((s) => ({
                    ...s,
                    inited: true,
                    title: init.title,
                    schema: init.schema,
                    uiSchema: init.uiSchema,
                    formData: init.formData ?? {},
                    pending: false,
                    result: null,
                }));
            } else if (msg?.type === 'result') {
                setState((s) => ({ ...s, pending: false, result: msg as ResultMessage }));
            }
        };
        window.addEventListener('message', handler);
        vscode.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', handler);
    }, []);

    if (!state.inited) {
        return React.createElement('div', null, 'Loading…');
    }

    return React.createElement(
        'div',
        null,
        React.createElement('h1', null, state.title),
        React.createElement(Form, {
            schema: state.schema,
            uiSchema: state.uiSchema,
            formData: state.formData,
            validator,
            onChange: (e: { formData: Record<string, unknown> }) =>
                setState((s) => ({ ...s, formData: e.formData })),
            onSubmit: (e: { formData: Record<string, unknown> }) => {
                setState((s) => ({ ...s, pending: true, result: null }));
                vscode.postMessage({ type: 'submit', formData: e.formData });
            },
            children: React.createElement(
                'div',
                { style: { marginTop: '1rem' } },
                React.createElement(
                    'button',
                    { type: 'submit', disabled: state.pending },
                    state.pending ? 'Applying…' : 'Apply',
                ),
                React.createElement(
                    'button',
                    {
                        type: 'button',
                        className: 'secondary',
                        onClick: () => vscode.postMessage({ type: 'cancel' }),
                    },
                    'Cancel',
                ),
            ),
        } as React.ComponentProps<typeof Form>),
        state.result ? renderResult(state.result) : null,
    );
}

function renderResult(result: ResultMessage): React.ReactElement {
    if (result.ok) {
        return React.createElement('div', { style: { marginTop: '1rem' } }, result.message ?? 'OK');
    }
    const errors = result.findings?.errors ?? [];
    const warnings = result.findings?.warnings ?? [];
    return React.createElement(
        'div',
        { className: 'findings' },
        React.createElement('strong', null, result.message ?? 'Validation failed.'),
        errors.length
            ? React.createElement(
                  'div',
                  null,
                  React.createElement('div', null, 'Errors:'),
                  React.createElement(
                      'ul',
                      null,
                      errors.map((e, i) => React.createElement('li', { key: `e${i}` }, e)),
                  ),
              )
            : null,
        warnings.length
            ? React.createElement(
                  'div',
                  null,
                  React.createElement('div', null, 'Warnings:'),
                  React.createElement(
                      'ul',
                      null,
                      warnings.map((w, i) => React.createElement('li', { key: `w${i}` }, w)),
                  ),
              )
            : null,
    );
}

const root = createRoot(document.getElementById('root')!);
root.render(React.createElement(App));
