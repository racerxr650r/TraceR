// Phase 2.5c — pure logic for the payload-agnostic Quick Fix table.
//
// Every helper in this module is deliberately payload-agnostic: it
// dispatches on the Finding.code value and on tokens parsed out of
// the finding message, never on a hard-coded payload element name
// (HLR-012, HLR-025). The TypeScript host plus a Python acceptance
// test under test/test_quickfix_acceptance.py exercise the same set
// of behaviours from both sides.
//
// The functions here return plain values (strings, ranges, replacement
// payloads) — they never touch the VS Code WorkspaceEdit API. The
// command layer (commands/quickFixes.ts) translates them into edits.

/** The set of Finding.code values that surface a Quick Fix today. */
export const QUICK_FIX_CODES = new Set<string>([
    'broken-trace',
    'id-format',
    'missing-template',
    'no-test',
]);

export type FixableCode =
    | 'broken-trace'
    | 'id-format'
    | 'missing-template'
    | 'no-test';

export function isFixableCode(code: unknown): code is FixableCode {
    return typeof code === 'string' && QUICK_FIX_CODES.has(code);
}

// ---------------------------------------------------------------------
// Message parsing — every parser pulls just enough off the human
// message that the linter already prints to drive a fix. Keeping the
// parsers here (rather than hidden in the command bodies) makes them
// trivially unit-testable and lets the Python acceptance test mirror
// the same parses without re-implementing them in two places.
// ---------------------------------------------------------------------

/** Pull the `'value'` (or `"value"`) substring out of a message. */
export function firstQuoted(message: string): string | undefined {
    const m = message.match(/'([^']+)'|"([^"]+)"/);
    return m ? (m[1] ?? m[2]) : undefined;
}

export interface BrokenTraceInfo {
    /** "HLR" or "LLR" — the trace target whose ref doesn't resolve. */
    target: 'HLR' | 'LLR';
    /** The bad reference text as it currently appears in the XML. */
    badRef: string;
}

export function parseBrokenTrace(message: string): BrokenTraceInfo | undefined {
    const m = message.match(/unknown\s+(HLR|LLR)\s+'([^']+)'/);
    if (!m) {
        return undefined;
    }
    return { target: m[1] as 'HLR' | 'LLR', badRef: m[2] };
}

export interface IdFormatInfo {
    /** "HLR" or "LLR" — the kind of id whose format is wrong. */
    kind: 'HLR' | 'LLR';
    /** The malformed id token. */
    badId: string;
    /** Detected prefix for LLRs (e.g. "GEN" out of "LLR-GEN-1"); undefined for HLRs. */
    prefix?: string;
}

export function parseIdFormat(message: string): IdFormatInfo | undefined {
    // Format: <hlr id="..."> does not match HLR-NNN
    //         <llr id="..."> does not match LLR-XXX-NN
    //         duplicate HLR id: HLR-001
    //         duplicate LLR id: LLR-PCL-01
    let m = message.match(/<(hlr|llr)\s+id="([^"]+)">/);
    if (m) {
        const kind = m[1].toUpperCase() as 'HLR' | 'LLR';
        const badId = m[2];
        const prefix = kind === 'LLR' ? extractLlrPrefix(badId) : undefined;
        return { kind, badId, prefix };
    }
    m = message.match(/duplicate\s+(HLR|LLR)\s+id:\s+(\S+)/);
    if (m) {
        const kind = m[1] as 'HLR' | 'LLR';
        const badId = m[2];
        const prefix = kind === 'LLR' ? extractLlrPrefix(badId) : undefined;
        return { kind, badId, prefix };
    }
    return undefined;
}

/** Best-effort: pull the function-name segment out of a malformed LLR id. */
export function extractLlrPrefix(badId: string): string {
    // Accept anything between "LLR-" and the trailing "-NN" or end of token.
    const m = badId.match(/^LLR-([A-Z0-9]+)(?:-.*)?$/i);
    if (m) {
        return m[1].toUpperCase();
    }
    return 'GEN';
}

export interface MissingTemplateInfo {
    /** The `<document id="..."/>` value. */
    docId: string;
    /** The repo-relative template path the linter said was missing. */
    templatePath: string;
}

export function parseMissingTemplate(message: string): MissingTemplateInfo | undefined {
    const m = message.match(
        /<document\s+id="([^"]+)">\s+references\s+missing\s+template\s+`([^`]+)`/,
    );
    if (!m) {
        return undefined;
    }
    return { docId: m[1], templatePath: m[2] };
}

export interface NoTestInfo {
    /** "HLR" or "LLR" — the orphan kind. */
    target: 'HLR' | 'LLR';
    /** The id of the orphan (e.g. "HLR-007", "LLR-PCL-01"). */
    targetId: string;
}

export function parseNoTest(message: string): NoTestInfo | undefined {
    const m = message.match(/^(HLR|LLR)\s+(\S+)\s+has no test verifying it/);
    if (!m) {
        return undefined;
    }
    return { target: m[1] as 'HLR' | 'LLR', targetId: m[2] };
}

// ---------------------------------------------------------------------
// Next-free id allocation. Used by id-format renumbering. Stays here
// (rather than in render_doc.py) because we want the WorkspaceEdit to
// be applied to the user's *unsaved* buffer if any — which the sidecar
// can't see — and because the algorithm is dead simple.
// ---------------------------------------------------------------------

/** Next free `HLR-NNN` given a list of existing HLR ids. */
export function nextFreeHlrId(existing: Iterable<string>): string {
    let max = 0;
    let width = 3;
    for (const id of existing) {
        const m = id.match(/^HLR-(\d+)$/);
        if (m) {
            const n = parseInt(m[1], 10);
            if (n > max) {
                max = n;
            }
            if (m[1].length > width) {
                width = m[1].length;
            }
        }
    }
    return `HLR-${String(max + 1).padStart(width, '0')}`;
}

/** Next free `LLR-PREFIX-NN` for a given prefix. */
export function nextFreeLlrId(prefix: string, existing: Iterable<string>): string {
    let max = 0;
    let width = 2;
    const upper = prefix.toUpperCase();
    const re = new RegExp(`^LLR-${escapeRe(upper)}-(\\d+)$`);
    for (const id of existing) {
        const m = id.match(re);
        if (m) {
            const n = parseInt(m[1], 10);
            if (n > max) {
                max = n;
            }
            if (m[1].length > width) {
                width = m[1].length;
            }
        }
    }
    return `LLR-${upper}-${String(max + 1).padStart(width, '0')}`;
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------
// Stub builders. The CodeActionProvider hands these to a WorkspaceEdit;
// the Python acceptance test calls them through a small TS->Python
// shim and re-runs lint to prove they produce a clean fixture.
// ---------------------------------------------------------------------

/** Minimal Jinja2 template stub written when fixing `missing-template`. */
export function templateStubContent(docId: string): string {
    return `# ${docId}\n\nGenerated stub for ${docId}. Replace with the real template.\n`;
}

/**
 * XML fragment inserted before `</tests>` when fixing `no-test`. The
 * fragment is payload-agnostic — it cites the orphan via a `<trace>`
 * regardless of whether the orphan is an HLR or LLR.
 */
export function stubTestFragment(info: NoTestInfo): string {
    const stubName = `test_${info.targetId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_stub`;
    const path = `test/test_${info.target.toLowerCase()}_stubs.py`;
    return [
        '  <file path="' + path + '" role="unit" count="1">',
        '    <test name="' + stubName + '">',
        '      <purpose>Stub test verifying ' + info.targetId + '. Replace with real assertions.</purpose>',
        '      <traces>',
        '        <trace target="' + info.target + '" ref="' + info.targetId + '"/>',
        '      </traces>',
        '    </test>',
        '  </file>',
    ].join('\n');
}
