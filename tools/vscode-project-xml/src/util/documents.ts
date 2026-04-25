// The hard-coded baseline document set rendered by Phase 2's
// `projectXml.renderAll` command. The Phase 2.5 retrofit replaces
// this constant with a call to the sidecar's `list_documents`
// method, which enumerates `<metadata><document>` entries from
// Project.xml at runtime. Until then, every consumer (renderAll,
// renderAndPreview QuickPick, the preview content provider) reads
// from this single named source so the swap is a one-line change.

import * as path from 'path';

export interface BaselineDocument {
    /** Document id matching `<metadata><document id="...">`. */
    readonly id: string;
    /** Human-readable title used in the QuickPick. */
    readonly title: string;
    /** Template file name under `tools/templates/`. */
    readonly template: string;
    /** Workspace-relative path the renderAll command writes to. */
    readonly source: string;
}

export const BASELINE_DOCUMENTS: readonly BaselineDocument[] = [
    {
        id: 'SDD',
        title: 'Software Design Document',
        template: 'SDD.md.j2',
        source: 'doc/SDD.md',
    },
    {
        id: 'HLRs',
        title: 'High-Level Requirements',
        template: 'HLRs.md.j2',
        source: 'doc/HLRs.md',
    },
    {
        id: 'LLRs',
        title: 'Low-Level Requirements',
        template: 'LLRs.md.j2',
        source: 'doc/LLRs.md',
    },
    {
        id: 'STP',
        title: 'Software Test Plan',
        template: 'STP.md.j2',
        source: 'doc/STP.md',
    },
    {
        id: 'Traceability',
        title: 'Traceability Matrix',
        template: 'Traceability.md.j2',
        source: 'doc/Traceability.md',
    },
];

export function findBaselineDocument(id: string): BaselineDocument | undefined {
    return BASELINE_DOCUMENTS.find((d) => d.id === id);
}

/** Absolute path of a baseline document's Jinja2 template. */
export function templatePath(toolsDir: string, doc: BaselineDocument): string {
    return path.join(toolsDir, 'templates', doc.template);
}

/** Absolute path the renderAll command writes the doc to. */
export function sourcePath(workspaceRoot: string, doc: BaselineDocument): string {
    return path.join(workspaceRoot, doc.source);
}
