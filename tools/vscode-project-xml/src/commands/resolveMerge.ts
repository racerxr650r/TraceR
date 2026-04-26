// Phase 5.5 — `projectXml.resolveMergeConflicts` command (HLR-063, HLR-067).
//
// Thin wrapper around `MergeConflictResolver.resolve()`. Lives in its
// own module so extension.ts only needs to import a single function
// per command (matching the convention used by other commands/).

import * as vscode from 'vscode';
import { MergeConflictResolver, MergeResolverDeps } from '../merge/MergeConflictResolver';

export const RESOLVE_MERGE_COMMAND = 'projectXml.resolveMergeConflicts';

export function registerResolveMergeCommand(
    deps: MergeResolverDeps,
): vscode.Disposable {
    const resolver = new MergeConflictResolver(deps);
    return vscode.commands.registerCommand(
        RESOLVE_MERGE_COMMAND,
        () => resolver.resolve(),
    );
}
