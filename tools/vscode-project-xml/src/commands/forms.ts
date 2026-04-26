// Phase 3 commands: addHlr, addLlr, editPayload.
//
// Phase 4 extends the same machinery to SDD modules, STP fixtures,
// test files, and individual <test> elements. Every command opens
// the same `FormPanelProvider`, just keyed on a different
// complex-type name from the XSD's `ui_hints_index`. The form
// derivation, JSON-Patch generation, and validate-then-write
// contract are payload-agnostic.

import * as vscode from 'vscode';
import { FormPanelProvider, FormPayloadKind } from '../forms/FormPanelProvider';
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
        type?: FormPayloadKind;
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


// --- Phase 4: SDD module / test file / <test> / STP fixture forms ---

/** Phase 4: add a new <module> under <sdd>/<modules>. */
export async function addModule(
    _sidecar: ProjectIoClient,
    formPanel: FormPanelProvider,
): Promise<void> {
    await formPanel.open({
        type: 'SddModule',
        title: 'New SDD Module',
        initial: {
            path: '',
            title: '',
            purpose: '',
            responsibility: '',
        },
        appendPath: '/sdd/modules/module/-',
    });
}

/** Phase 4: add a new <fixture> under <stp>/<integration_environment>. */
export async function addStpFixture(
    _sidecar: ProjectIoClient,
    formPanel: FormPanelProvider,
): Promise<void> {
    await formPanel.open({
        type: 'StpFixture',
        title: 'New STP Fixture',
        initial: { name: '', source: '' },
        appendPath: '/stp/integration_environment/fixture/-',
    });
}

/** Phase 4: add a new <file> under <tests>. */
export async function addTestFile(
    _sidecar: ProjectIoClient,
    formPanel: FormPanelProvider,
): Promise<void> {
    await formPanel.open({
        type: 'TestFile',
        title: 'New Test File',
        initial: { path: '', role: 'unit' },
        appendPath: '/tests/file/-',
    });
}

/** Phase 4: add a new <test> under an existing <tests>/<file>. */
export async function addTest(
    sidecar: ProjectIoClient,
    formPanel: FormPanelProvider,
): Promise<void> {
    const files = await fetchTestFiles(sidecar);
    if (!files.length) {
        void vscode.window.showWarningMessage(
            'Project Spec: no <file> elements under <tests>. Add one first via Add Test File.',
        );
        return;
    }
    const pick = await vscode.window.showQuickPick(
        files.map((f) => ({
            label: f.path,
            description: `${f.testCount} test(s)`,
            file: f,
        })),
        { placeHolder: 'Pick the test file the new <test> belongs to' },
    );
    if (!pick) {
        return;
    }
    await formPanel.open({
        type: 'Test',
        title: `New Test (in ${pick.file.path})`,
        initial: { name: '', purpose: '' },
        appendPath: `/tests/file[path=${pick.file.path}]/test/-`,
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

interface TestFileSummary {
    path: string;
    testCount: number;
}

async function fetchTestFiles(sidecar: ProjectIoClient): Promise<TestFileSummary[]> {
    const parsed = await sidecar.parseToJson();
    const files = (parsed as { tests?: Array<Record<string, unknown>> }).tests ?? [];
    return files
        .map((f) => ({
            path: String(f.path ?? ''),
            testCount: Array.isArray(f.tests) ? f.tests.length : 0,
        }))
        .filter((f) => f.path.length > 0);
}
