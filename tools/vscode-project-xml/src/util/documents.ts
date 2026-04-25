// Schema-driven document discovery.
//
// Phase 2.5 retrofit: the previous hard-coded `BASELINE_DOCUMENTS`
// constant has been replaced with a single async `loadDocuments`
// function that asks the sidecar's `list_documents` JSON-RPC method
// to enumerate every `<metadata><document>` entry in Project.xml.
//
// The result is cached per `ProjectIoClient` instance and invalidated
// only by `invalidateDocumentsCache(client)` (called from the
// "refresh" command and after a `Project.xml` save). This means a new
// generated document — or a new payload section that ships its own
// `<metadata><document>` entry — appears in the tree, the
// QuickPick, the per-document `projectXml.render.<id>` commands, and
// the renderAll loop on the next refresh, with zero TypeScript
// edits (PVD §6 #11, §8 "Schema-driven extensibility").

import * as path from 'path';
import {
    DocumentInfo,
    ProjectIoClient,
} from '../sidecar';

/**
 * Compatibility alias for the Phase-1 type name. Existing imports of
 * `BaselineDocument` continue to work; the underlying shape is the
 * sidecar's `DocumentInfo` (id, title, source, version, date,
 * author, template, output).
 */
export type BaselineDocument = DocumentInfo;

const cache = new WeakMap<ProjectIoClient, Promise<readonly DocumentInfo[]>>();

/**
 * Discover the document set for the current Project.xml via the
 * sidecar. Cached per client instance; call
 * `invalidateDocumentsCache(client)` to force a refresh.
 */
export async function loadDocuments(
    client: ProjectIoClient,
): Promise<readonly DocumentInfo[]> {
    let pending = cache.get(client);
    if (pending) {
        return pending;
    }
    pending = client
        .listDocuments()
        .then((res) => Object.freeze(res.documents.slice()));
    cache.set(client, pending);
    try {
        return await pending;
    } catch (err) {
        // Don't pin a failed lookup; let the next caller retry.
        cache.delete(client);
        throw err;
    }
}

export function invalidateDocumentsCache(client: ProjectIoClient): void {
    cache.delete(client);
}

/**
 * Find a document by id within a list returned by `loadDocuments`.
 * The list is passed in (rather than re-fetched) so callers stay
 * synchronous after their first await; this keeps tree-view item
 * builders simple.
 */
export function findBaselineDocument(
    docs: readonly DocumentInfo[],
    id: string,
): DocumentInfo | undefined {
    return docs.find((d) => d.id === id);
}

/**
 * Absolute path of a document's Jinja2 template.
 *
 * `doc.template` is workspace-relative (e.g.
 * `tools/templates/SDD.md.j2`), so this just joins it onto the
 * workspace root rather than poking at the tools directory.
 */
export function templatePath(workspaceRoot: string, doc: DocumentInfo): string {
    if (path.isAbsolute(doc.template)) {
        return doc.template;
    }
    return path.join(workspaceRoot, doc.template);
}

/**
 * Absolute path the renderAll command writes the doc to.
 *
 * Uses `doc.output` (the optional `output=` attribute on
 * `<metadata><document>`) when present, falling back to `doc.source`
 * otherwise; the sidecar already normalises this so the field is
 * always populated.
 */
export function sourcePath(workspaceRoot: string, doc: DocumentInfo): string {
    const rel = doc.output || doc.source;
    if (path.isAbsolute(rel)) {
        return rel;
    }
    return path.join(workspaceRoot, rel);
}
