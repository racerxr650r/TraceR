// "Project Spec: Reveal in Project.xml" — opens Project.xml and
// scrolls/selects the requested element. Driven by the locator on
// each tree node; if the element can't be found we open the file at
// the top and surface a warning toast.

import * as vscode from 'vscode';
import { ProjectSpecNode, RevealLocator } from '../treeView/ProjectSpecProvider';
import { getProjectXmlUri } from '../util/paths';
import {
    findAttrRange,
    findElementRange,
    findIdRange,
} from '../util/locator';

export async function revealInXml(
    nodeOrLocator: ProjectSpecNode | RevealLocator | undefined,
): Promise<void> {
    const locator = toLocator(nodeOrLocator);
    if (!locator) {
        vscode.window.showWarningMessage(
            'Project Spec: nothing to reveal for this item.',
        );
        return;
    }
    const uri = getProjectXmlUri();
    if (!uri) {
        vscode.window.showWarningMessage(
            'Project Spec: Project.xml is not configured.',
        );
        return;
    }
    let doc: vscode.TextDocument;
    try {
        doc = await vscode.workspace.openTextDocument(uri);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Project Spec: cannot open Project.xml — ${message}`);
        return;
    }
    const range = resolveRange(doc, locator);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    if (range) {
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } else {
        vscode.window.showWarningMessage(
            `Project Spec: ${describeLocator(locator)} not found in Project.xml.`,
        );
    }
}

function toLocator(arg: ProjectSpecNode | RevealLocator | undefined): RevealLocator | undefined {
    if (!arg) {
        return undefined;
    }
    if (arg instanceof ProjectSpecNode) {
        return arg.locator;
    }
    return arg;
}

function resolveRange(
    doc: vscode.TextDocument,
    locator: RevealLocator,
): vscode.Range | undefined {
    const attr = locator.attr ?? 'id';
    if (!locator.value) {
        return findElementRange(doc, locator.tag);
    }
    if (attr === 'id') {
        return findIdRange(doc, locator.tag, locator.value);
    }
    return findAttrRange(doc, locator.tag, attr, locator.value);
}

function describeLocator(locator: RevealLocator): string {
    if (!locator.value) {
        return `<${locator.tag}>`;
    }
    return `<${locator.tag} ${locator.attr ?? 'id'}="${locator.value}">`;
}
