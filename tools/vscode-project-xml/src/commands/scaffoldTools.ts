// Phase 6 (LLR-PKG-04, HLR-061): copy the extension's bundled
// `dist/python/` tree into the workspace's `<projectXml.toolsDir>`
// so brand-new repos are immediately self-contained — the CLI,
// CI, and contributors without the extension installed all work
// without further setup, and Red Hat's XML extension's
// `xsi:noNamespaceSchemaLocation="tools/project.xsd"` resolves
// locally.
//
// Files that already exist in the workspace are skipped by default;
// when at least one collision is found, a single modal warning
// asks whether to overwrite all, skip them, or cancel.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    getBundledToolsDir,
    getConfig,
    getProjectFolder,
} from '../util/paths';

export const SCAFFOLD_TOOLS_COMMAND = 'projectXml.scaffoldTools';

export interface ScaffoldOptions {
    /** When true, suppress the modal collision prompt and overwrite
     *  every file. Used by `initProject` (target lacked tools/) and
     *  by the freshness notification's `Re-scaffold tools/` action. */
    overwrite?: boolean;
    /** When true, suppress the final completion notification (used
     *  by `initProject` which already shows its own toast). */
    silent?: boolean;
}

interface ScaffoldResult {
    written: number;
    skipped: number;
    overwritten: number;
}

/**
 * Run the scaffold flow. Returns a summary object on success or
 * undefined if cancelled / unable to resolve a target.
 */
export async function scaffoldTools(
    options: ScaffoldOptions = {},
): Promise<ScaffoldResult | undefined> {
    const bundled = getBundledToolsDir();
    if (!bundled) {
        void vscode.window.showErrorMessage(
            'Project Spec: cannot scaffold — the bundled tools/ tree was not found ' +
            'inside the extension. Re-install the extension or run `npm run prepackage` ' +
            'in the extension source.',
        );
        return undefined;
    }

    const folder = getProjectFolder();
    if (!folder) {
        void vscode.window.showErrorMessage(
            'Project Spec: cannot scaffold — no workspace folder is open.',
        );
        return undefined;
    }

    const rel = getConfig().get<string>('toolsDir') ?? 'tools';
    const target = path.isAbsolute(rel)
        ? rel
        : path.join(folder.uri.fsPath, rel);

    // Plan the copy first so we can prompt about collisions ONCE.
    const plan = planCopy(bundled, target);

    let mode: 'overwrite' | 'skip';
    if (plan.collisions.length === 0 || options.overwrite) {
        mode = options.overwrite ? 'overwrite' : 'skip';
    } else {
        const choice = await vscode.window.showWarningMessage(
            `Project Spec: ${plan.collisions.length} file(s) already exist in ` +
            `${path.relative(folder.uri.fsPath, target) || rel}. Overwrite them, ` +
            'skip the existing files, or cancel?',
            { modal: true },
            'Overwrite all',
            'Skip existing',
        );
        if (choice === 'Overwrite all') {
            mode = 'overwrite';
        } else if (choice === 'Skip existing') {
            mode = 'skip';
        } else {
            return undefined;
        }
    }

    fs.mkdirSync(target, { recursive: true });
    const result: ScaffoldResult = { written: 0, skipped: 0, overwritten: 0 };
    for (const item of plan.items) {
        const dstParent = path.dirname(item.dst);
        fs.mkdirSync(dstParent, { recursive: true });
        const exists = fs.existsSync(item.dst);
        if (exists && mode === 'skip') {
            result.skipped += 1;
            continue;
        }
        fs.copyFileSync(item.src, item.dst);
        if (exists) {
            result.overwritten += 1;
        } else {
            result.written += 1;
        }
    }

    if (!options.silent) {
        void vscode.window.showInformationMessage(
            `Project Spec: scaffold complete — ${result.written} new, ` +
            `${result.overwritten} overwritten, ${result.skipped} skipped.`,
        );
    }
    return result;
}

interface CopyItem {
    src: string;
    dst: string;
}
interface CopyPlan {
    items: CopyItem[];
    collisions: string[];
}

function planCopy(srcRoot: string, dstRoot: string): CopyPlan {
    const items: CopyItem[] = [];
    const collisions: string[] = [];
    walk(srcRoot, '');
    return { items, collisions };

    function walk(srcDir: string, rel: string): void {
        for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
            // Skip pyc cruft if it ever sneaks into dist/python.
            if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) {
                continue;
            }
            const childRel = rel ? path.join(rel, entry.name) : entry.name;
            const srcPath = path.join(srcDir, entry.name);
            const dstPath = path.join(dstRoot, childRel);
            if (entry.isDirectory()) {
                walk(srcPath, childRel);
            } else if (entry.isFile()) {
                items.push({ src: srcPath, dst: dstPath });
                if (fs.existsSync(dstPath)) {
                    collisions.push(childRel);
                }
            }
        }
    }
}

export function registerScaffoldToolsCommand(
    context: vscode.ExtensionContext,
): vscode.Disposable {
    const disposable = vscode.commands.registerCommand(
        SCAFFOLD_TOOLS_COMMAND,
        (opts?: ScaffoldOptions) => scaffoldTools(opts ?? {}),
    );
    context.subscriptions.push(disposable);
    return disposable;
}
