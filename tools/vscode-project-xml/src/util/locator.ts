// Locator: turn a logical handle (an HLR id, an LLR id, a test name,
// an SDD module path) into a vscode.Range inside Project.xml.
//
// Phase 1 is read-only and does not parse XML on the TypeScript side
// (parse_to_json is the source of truth). For diagnostic ranges and
// "Reveal in XML" we only need to find the right line, so a regex over
// the document text is sufficient and keeps us free of an XML parser
// dependency. If a token is not found, we fall back to the file head.

import * as vscode from 'vscode';

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

function reEscape(s: string): string {
    return s.replace(ESCAPE, '\\$&');
}

function findRange(doc: vscode.TextDocument, pattern: RegExp): vscode.Range | undefined {
    const text = doc.getText();
    pattern.lastIndex = 0;
    const m = pattern.exec(text);
    if (!m) {
        return undefined;
    }
    const start = doc.positionAt(m.index);
    const end = doc.positionAt(m.index + m[0].length);
    return new vscode.Range(start, end);
}

/**
 * Locate `<TAG ... id="ID">`, ranged over the whole id attribute value.
 * Used for HLR and LLR ids.
 */
export function findIdRange(
    doc: vscode.TextDocument,
    tag: string,
    id: string,
): vscode.Range | undefined {
    const re = new RegExp(
        `<${reEscape(tag)}\\b[^>]*?\\bid="${reEscape(id)}"`,
        'm',
    );
    const text = doc.getText();
    const m = re.exec(text);
    if (!m) {
        return undefined;
    }
    // Range over just the id="..." attribute, not the whole tag, so the
    // diagnostic underline targets the meaningful token.
    const idAttr = `id="${id}"`;
    const idIndex = m.index + m[0].indexOf(idAttr);
    const start = doc.positionAt(idIndex);
    const end = doc.positionAt(idIndex + idAttr.length);
    return new vscode.Range(start, end);
}

/** Locate `<test name="NAME">` or `<file path="PATH">`. */
export function findAttrRange(
    doc: vscode.TextDocument,
    tag: string,
    attr: string,
    value: string,
): vscode.Range | undefined {
    const re = new RegExp(
        `<${reEscape(tag)}\\b[^>]*?\\b${reEscape(attr)}="${reEscape(value)}"`,
        'm',
    );
    return findRange(doc, re);
}

/** Locate the opening `<TAG>` element. */
export function findElementRange(
    doc: vscode.TextDocument,
    tag: string,
): vscode.Range | undefined {
    return findRange(doc, new RegExp(`<${reEscape(tag)}\\b`, 'm'));
}

/** Best-effort range for a finding string. Returns line 1 if nothing matches. */
export function rangeForFinding(
    doc: vscode.TextDocument,
    finding: string,
    registry: IdScanEntry[] = DEFAULT_ID_SCAN_REGISTRY,
): vscode.Range {
    // Preferred: schema-driven registry. For each registered element,
    // scan the finding text for tokens matching its id pattern and
    // try to range them in the document.
    for (const entry of registry) {
        entry.valuePattern.lastIndex = 0;
        const matches = finding.match(entry.valuePattern) ?? [];
        for (const value of matches) {
            const r = entry.idAttr === 'id'
                ? findIdRange(doc, entry.tag, value)
                : findAttrRange(doc, entry.tag, entry.idAttr, value);
            if (r) {
                return r;
            }
        }
    }
    // Quoted token — try to match it as an attribute value, then as a tag name.
    const quoted = finding.match(/'([^']+)'|"([^"]+)"/);
    if (quoted) {
        const value = quoted[1] ?? quoted[2];
        if (value) {
            const text = doc.getText();
            const idx = text.indexOf(`"${value}"`);
            if (idx >= 0) {
                const start = doc.positionAt(idx + 1);
                const end = doc.positionAt(idx + 1 + value.length);
                return new vscode.Range(start, end);
            }
        }
    }
    // <element> mention.
    const elt = finding.match(/<([a-zA-Z_][\w-]*)>/);
    if (elt) {
        const r = findElementRange(doc, elt[1]);
        if (r) {
            return r;
        }
    }
    // Fallback: top of file.
    return new vscode.Range(0, 0, 0, 0);
}

/**
 * Phase 2.5b Slice G: schema-driven id-scan registry.
 *
 * Each entry tells `rangeForFinding` how to recognise an id token in
 * a finding string and where to look for it in `Project.xml`:
 *
 *   - `tag`           lowercase XML element to scan (`hlr`, `llr`, ...)
 *   - `idAttr`        attribute on that element holding the id
 *   - `valuePattern`  global regex used to extract candidate values
 *                     from the finding text
 *
 * `DEFAULT_ID_SCAN_REGISTRY` matches the legacy behaviour
 * (`HLR-NNN`, `LLR-XXX-NN`). Callers (e.g. `LintDiagnosticsProvider`)
 * can build a richer registry from `_ui_hints_index` and pass it in.
 */
export interface IdScanEntry {
    readonly tag: string;
    readonly idAttr: string;
    readonly valuePattern: RegExp;
}

export const DEFAULT_ID_SCAN_REGISTRY: IdScanEntry[] = [
    { tag: 'hlr', idAttr: 'id', valuePattern: /\bHLR-\d+\b/g },
    { tag: 'llr', idAttr: 'id', valuePattern: /\bLLR-[A-Z0-9]+-\d+\b/g },
];

/**
 * Build a finding-scan registry from the per-type entries in
 * `_ui_hints_index`. Entries without a `tree_node` (e.g. `Document`)
 * are skipped. The default value pattern matches dash-separated
 * upper-case tokens like `HLR-001` or `LLR-PCL-01`; a per-tag
 * override map lets the caller plug in tighter patterns when the
 * generic one would over-match.
 */
export function buildIdScanRegistryFromHints(
    hints:
        | Record<string, { tree_node: { id_attr: string } | null; element: string | null }>
        | undefined,
    overrides: Record<string, RegExp> = DEFAULT_ID_PATTERN_OVERRIDES,
): IdScanEntry[] {
    if (!hints) {
        return DEFAULT_ID_SCAN_REGISTRY;
    }
    const out: IdScanEntry[] = [];
    const seen = new Set<string>();
    for (const key of Object.keys(hints)) {
        const entry = hints[key];
        if (!entry?.tree_node || !entry.element) {
            continue;
        }
        if (seen.has(entry.element)) {
            continue;
        }
        seen.add(entry.element);
        const idAttr = entry.tree_node.id_attr || 'id';
        const valuePattern = overrides[entry.element]
            ?? new RegExp('\\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\\b', 'g');
        out.push({ tag: entry.element, idAttr, valuePattern });
    }
    return out.length > 0 ? out : DEFAULT_ID_SCAN_REGISTRY;
}

/** Tag-specific patterns used by the default registry builder. */
const DEFAULT_ID_PATTERN_OVERRIDES: Record<string, RegExp> = {
    hlr: /\bHLR-\d+\b/g,
    llr: /\bLLR-[A-Z0-9]+-\d+\b/g,
};
