// Phase 5b — TS-side mirror of `tools/ai/registry.py`.
//
// The Python sidecar is the source of truth at runtime (the chat
// participant calls `ai_request`, which validates against the same
// registry). This mirror exists so the TS layer can:
//
//   * register a chat participant with the right slash → intent map
//     before the sidecar has been consulted;
//   * describe a tree-menu entry (label, kind) without a round trip;
//   * map an `aiActions: string[]` projection from `ui_hints_index`
//     onto labelled commands.
//
// Adding a new intent requires updating `tools/ai/registry.py` (the
// authoritative source), `tools/ai/schemas/*.json`, the prompt file
// under `tools/ai/intents/`, and this mirror in lock-step. Tests in
// `test/test_ai_registry.py` and the unit test for this file exercise
// the matching.

export type IntentKind = 'authoring' | 'pvd' | 'advisory' | 'merge';

export interface IntentSpec {
    id: string;
    label: string;
    kind: IntentKind;
    /** Complex-type names this intent targets; empty array = global. */
    targets: readonly string[];
    /** Slash command without the leading `/`. */
    slash: string;
}

export const INTENTS: readonly IntentSpec[] = [
    { id: 'draft.module',       label: 'Draft SDD module with AI',     kind: 'authoring', targets: ['SddModule'], slash: 'draft-module' },
    { id: 'draft.hlr',          label: 'Draft HLR with AI',            kind: 'authoring', targets: ['Hlr'],       slash: 'draft-hlr' },
    { id: 'draft.llr',          label: 'Draft LLR with AI',            kind: 'authoring', targets: ['Llr'],       slash: 'draft-llr' },
    { id: 'draft.test',         label: 'Draft test with AI',           kind: 'authoring', targets: ['Test'],      slash: 'draft-test' },
    { id: 'draft.pvd',          label: 'Draft PVD section with AI',    kind: 'pvd',       targets: [],            slash: 'draft-pvd' },
    { id: 'expand.hlr_to_llrs', label: 'Expand HLR to LLRs with AI',   kind: 'authoring', targets: ['Hlr'],       slash: 'expand' },
    { id: 'expand.llr_to_tests',label: 'Expand LLR to tests with AI',  kind: 'authoring', targets: ['Llr'],       slash: 'expand' },
    { id: 'review.item',        label: 'Review with AI',               kind: 'advisory',  targets: ['Hlr', 'Llr', 'Test', 'SddModule'], slash: 'review' },
    { id: 'suggest.traces',     label: 'Suggest traces with AI',       kind: 'authoring', targets: ['Hlr', 'Llr', 'Test'],               slash: 'suggest-traces' },
    { id: 'gap.fix',            label: 'Fix coverage gap with AI',     kind: 'authoring', targets: ['Hlr', 'Llr'],                       slash: 'gap-fill' },
    // Phase 5.5 (HLR-063..069): merge conflict resolution. All four
    // share the `/resolve-conflicts` slash; the resolver picks the
    // right intent per residual conflict kind.
    { id: 'merge.body',         label: 'AI suggestion for body conflict',         kind: 'merge', targets: ['Hlr', 'Llr', 'Test', 'SddModule'], slash: 'resolve-conflicts' },
    { id: 'merge.trace',        label: 'AI suggestion for trace conflict',        kind: 'merge', targets: ['Traces'],                          slash: 'resolve-conflicts' },
    { id: 'merge.rename',       label: 'AI suggestion for id collision',          kind: 'merge', targets: ['Hlr', 'Llr'],                      slash: 'resolve-conflicts' },
    { id: 'merge.schema_bump',  label: 'AI suggestion for schema_version bump',   kind: 'merge', targets: ['Project'],                         slash: 'resolve-conflicts' },
];

const BY_ID = new Map<string, IntentSpec>(INTENTS.map((i) => [i.id, i]));

export function getIntent(id: string): IntentSpec | undefined {
    return BY_ID.get(id);
}

/** Return the slash commands the chat participant should accept. */
export function slashCommands(): readonly string[] {
    const set = new Set<string>();
    for (const i of INTENTS) {
        set.add(i.slash);
    }
    return Array.from(set);
}

/**
 * Resolve the intent for a given slash command and (optional) target
 * complex-type name. The two `expand.*` intents share the `/expand`
 * slash and disambiguate on the target type — pass it when the user
 * issued the slash from a tree node or with a `--target Hlr` style
 * prompt; without it `/expand` defaults to `expand.hlr_to_llrs`.
 */
export function intentForSlash(
    slash: string,
    targetType?: string,
): IntentSpec | undefined {
    const matches = INTENTS.filter((i) => i.slash === slash);
    if (matches.length === 0) {
        return undefined;
    }
    if (matches.length === 1 || !targetType) {
        return matches[0];
    }
    return (
        matches.find((i) => i.targets.includes(targetType)) ?? matches[0]
    );
}

/**
 * Project an `ai_actions: string[]` list (from `ui_hints_index`) onto
 * labelled `IntentSpec` entries, dropping anything the TS mirror
 * doesn't know about. The result preserves the registry's declaration
 * order so menu entries are deterministic across runs.
 */
export function intentsForActions(actions: readonly string[]): IntentSpec[] {
    if (!actions || actions.length === 0) {
        return [];
    }
    const wanted = new Set(actions);
    return INTENTS.filter((i) => wanted.has(i.id));
}
