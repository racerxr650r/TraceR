// Phase 3 commands: addHlr, addLlr, editPayload.
//
// `addHlr` / `addLlr` open a blank form keyed on the Hlr / Llr UI
// hint entry and let apply_edit allocate the new element under the
// section/function the user picks. `editPayload` re-opens an
// existing node in edit mode so the same form code services both
// add and edit flows.

import * as vscode from 'vscode';
import { FormPanelProvider } from '../forms/FormPanelProvider';
import { ProjectIoClient } from '../sidecar';

/** Open the form in add mode for a new HLR. */
export async function addHlr(
    sidecar: ProjectIoClient,
    formPanel: FormPanelProvider,
): Promise<void> {
    const sections = await fetchSections(sidecar);
    if (!sections.length) {
        void vscode.window.showWarningMessage(
            'Project Spec: no <section> elements under <hlrs>. Add one first.',
        );
        return;
    }
    const pick = await vscode.window.showQuickPick(
        sections.map((s) => ({
            label: `Section ${s.number}: ${s.title}`,
            description: `${(s.count ?? 0)} HLR(s)`,
            section: s,
        })),
        { placeHolder: 'Pick the HLR section the new requirement belongs to' },
    );
    if (!pick) {
        return;
    }
    let nextId: string;
    try {
        ({ id: nextId } = await sidecar.nextFreeId({ kind: 'hlr' }));
    } catch (err) {
        void vscode.window.showErrorMessage(
            `next_free_id failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
    }
    await formPanel.open({
        type: 'Hlr',
        title: `New HLR (${nextId})`,
        initial: { id: nextId, name: '', text: '' },
        appendPath: `/hlrs/section[number=${pick.section.number}]/hlr/-`,
    });
}

/** Open the form in add mode for a new LLR. */
export async function addLlr(
    sidecar: ProjectIoClient,
    formPanel: FormPanelProvider,
): Promise<void> {
    const functions = await fetchFunctions(sidecar);
    if (!functions.length) {
        void vscode.window.showWarningMessage(
            'Project Spec: no <function> elements under <llrs>. Add one first.',
        );
        return;
    }
    const pick = await vscode.window.showQuickPick(
        functions.map((f) => ({
            label: `Function ${f.number}: ${f.title}`,
            description: `prefix LLR-${f.name.toUpperCase()}-NN`,
            fn: f,
        })),
        { placeHolder: 'Pick the LLR function the new requirement belongs to' },
    );
    if (!pick) {
        return;
    }
    let nextId: string;
    try {
        ({ id: nextId } = await sidecar.nextFreeId({
            kind: 'llr',
            function: pick.fn.name.toUpperCase(),
        }));
    } catch (err) {
        void vscode.window.showErrorMessage(
            `next_free_id failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
    }
    await formPanel.open({
        type: 'Llr',
        title: `New LLR (${nextId})`,
        initial: { id: nextId, text: '' },
        appendPath: `/llrs/function[number=${pick.fn.number}]/llr/-`,
    });
}

/**
 * Open the form in edit mode for a node addressed by `args`. Invoked
 * from a tree-view context menu on hlr/llr items; `args` is the same
 * `{ basePath, type, formData }` shape the tree provider stamps onto
 * its TreeItems' `command.arguments`.
 */
export async function editPayload(
    formPanel: FormPanelProvider,
    args?: {
        type?: 'Hlr' | 'Llr';
        basePath?: string;
        formData?: Record<string, unknown>;
        title?: string;
    },
): Promise<void> {
    if (!args?.type || !args.basePath) {
        void vscode.window.showErrorMessage(
            'Project Spec: editPayload requires {type, basePath}.',
        );
        return;
    }
    await formPanel.open({
        type: args.type,
        title: args.title ?? `Edit ${args.type}`,
        initial: args.formData ?? {},
        basePath: args.basePath,
    });
}


// --- helpers --------------------------------------------------------

interface SectionSummary {
    number: string;
    title: string;
    count?: number;
}

interface FunctionSummary {
    number: string;
    title: string;
    name: string;
}

async function fetchSections(sidecar: ProjectIoClient): Promise<SectionSummary[]> {
    const parsed = await sidecar.parseToJson();
    const sections = parsed?.hlrs ?? [];
    return sections.map((s) => ({
        number: String(s.number ?? ''),
        title: String(s.title ?? ''),
        count: Array.isArray(s.hlrs) ? s.hlrs.length : 0,
    })).filter((s) => s.number.length > 0);
}

async function fetchFunctions(sidecar: ProjectIoClient): Promise<FunctionSummary[]> {
    const parsed = await sidecar.parseToJson();
    const functions = parsed?.llrs ?? [];
    return functions.map((f) => ({
        number: String((f as Record<string, unknown>).number ?? ''),
        title: String((f as Record<string, unknown>).title ?? ''),
        name: String((f as Record<string, unknown>).name ?? ''),
    })).filter((f) => f.number.length > 0 && f.name.length > 0);
}
