// Workspace path resolution helpers. The extension stays workspace-
// agnostic by routing every filesystem path through the helpers below.
//
// We pick the workspace folder that actually contains the configured
// xmlPath (default doc/Project.xml). This means the user can open
// either the TraceR repo root or a parent multi-root workspace and
// still get correct sidecar / xsd paths.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function getConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('projectXml');
}

/**
 * Find the workspace folder whose root contains the configured
 * Project.xml. Falls back to the first workspace folder if no folder
 * contains the file (e.g. brand-new workspace before --init).
 */
export function getProjectFolder(): vscode.WorkspaceFolder | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return undefined;
    }
    const rel = getConfig().get<string>('xmlPath') ?? 'doc/Project.xml';
    if (path.isAbsolute(rel)) {
        return folders[0];
    }
    for (const folder of folders) {
        const candidate = path.join(folder.uri.fsPath, rel);
        if (fs.existsSync(candidate)) {
            return folder;
        }
    }
    return folders[0];
}

function resolveAgainstProject(rel: string): string | undefined {
    if (path.isAbsolute(rel)) {
        return rel;
    }
    const folder = getProjectFolder();
    if (!folder) {
        return undefined;
    }
    return path.join(folder.uri.fsPath, rel);
}

export function getProjectXmlPath(): string | undefined {
    const rel = getConfig().get<string>('xmlPath') ?? 'doc/Project.xml';
    return resolveAgainstProject(rel);
}

export function getProjectXmlUri(): vscode.Uri | undefined {
    const fsPath = getProjectXmlPath();
    return fsPath ? vscode.Uri.file(fsPath) : undefined;
}

export function getXsdPath(): string | undefined {
    const rel = getConfig().get<string>('xsdPath') ?? 'tools/project.xsd';
    return resolveAgainstProject(rel);
}

export function getToolsDir(): string | undefined {
    const rel = getConfig().get<string>('toolsDir') ?? 'tools';
    return resolveAgainstProject(rel);
}

export function getProjectIoScript(): string | undefined {
    const tools = getToolsDir();
    return tools ? path.join(tools, 'project_io.py') : undefined;
}

/**
 * Human-readable explanation of why path resolution failed. Used by
 * the sidecar / tree to show actionable error messages instead of the
 * generic "toolsDir is not set" string.
 */
export function describeWorkspaceState(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return 'No workspace folder is open. Open the TraceR repository folder (File → Open Folder…) and reload.';
    }
    const rel = getConfig().get<string>('xmlPath') ?? 'doc/Project.xml';
    const folderList = folders.map((f) => f.uri.fsPath).join(', ');
    return `Could not find ${rel} in any open workspace folder (${folderList}). Open the folder that contains doc/Project.xml, or set projectXml.xmlPath / projectXml.toolsDir explicitly.`;
}
