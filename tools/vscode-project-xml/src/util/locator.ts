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
): vscode.Range {
    // Prefer HLR-NNN and LLR-XXX-NN tokens since they're contract ids.
    const hlrIds = finding.match(/\bHLR-\d+\b/g) ?? [];
    for (const id of hlrIds) {
        const r = findIdRange(doc, 'hlr', id);
        if (r) {
            return r;
        }
    }
    const llrIds = finding.match(/\bLLR-[A-Z0-9]+-\d+\b/g) ?? [];
    for (const id of llrIds) {
        const r = findIdRange(doc, 'llr', id);
        if (r) {
            return r;
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
