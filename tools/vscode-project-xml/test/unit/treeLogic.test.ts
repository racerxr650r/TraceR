import { strict as assert } from 'assert';
import {
    buildTopLevelDescriptors,
    buildGenericPayloadDescriptors,
    COVERED_TYPE_KEYS,
    decorate,
    decorateAiTargetable,
    labelSeverity,
    leafLocator,
    locatorMeta,
    propagateBadgeSeverity,
    renderLabel,
    tracesForForm,
    TreeNodeDescriptor,
    worstSeverity,
} from '../../src/treeView/treeLogic';
import { ParsedProject, ParsedNode, UiHintsIndex } from '../../src/sidecar';

describe('treeLogic', () => {
    describe('decorate', () => {
        it('prepends badge when present', () => {
            assert.equal(decorate('HLR-001', '\u274c'), '\u274c HLR-001');
        });
        it('returns label unchanged when no badge', () => {
            assert.equal(decorate('HLR-001', undefined), 'HLR-001');
        });
    });

    describe('renderLabel', () => {
        it('substitutes @attr tokens', () => {
            const node: ParsedNode = { tag: 'hlr', attrs: { id: 'HLR-001', name: 'Foo' }, ui: null, text: null };
            assert.equal(renderLabel('@id @name', node), 'HLR-001 Foo');
        });
        it('trims trailing separator when attr missing', () => {
            const node: ParsedNode = { tag: 'hlr', attrs: { id: 'HLR-001' }, ui: null, text: null };
            assert.equal(renderLabel('@id \u2014 @name', node), 'HLR-001');
        });
        it('returns empty for no matches', () => {
            const node: ParsedNode = { tag: 'hlr', attrs: {}, ui: null, text: null };
            assert.equal(renderLabel('@id', node), '');
        });
    });

    describe('labelSeverity', () => {
        it('detects error', () => { assert.equal(labelSeverity('\u274c HLR-001'), 'error'); });
        it('detects warning', () => { assert.equal(labelSeverity('\u26a0 HLR-001'), 'warning'); });
        it('returns undefined for normal', () => { assert.equal(labelSeverity('HLR-001'), undefined); });
    });

    describe('worstSeverity', () => {
        it('returns error when any item has error icon', () => {
            assert.equal(worstSeverity([
                { label: 'ok', iconId: 'warning' },
                { label: 'bad', iconId: 'error' },
            ]), 'error');
        });
        it('returns warning for warnings only', () => {
            assert.equal(worstSeverity([
                { label: '\u26a0 x' },
                { label: 'ok' },
            ]), 'warning');
        });
        it('returns undefined when clean', () => {
            assert.equal(worstSeverity([{ label: 'ok' }]), undefined);
        });
    });

    describe('locatorMeta', () => {
        it('uses hints when available', () => {
            const hints: UiHintsIndex = {
                Hlr: {
                    tree_node: { label: '@id', id_attr: 'id', group: 'hlrs' },
                    form: [], lenses: [], document: false, element: 'hlr',
                },
            };
            const meta = locatorMeta(hints, 'Hlr', 'fallback', 'fallback_attr');
            assert.equal(meta.tag, 'hlr');
            assert.equal(meta.idAttr, 'id');
        });
        it('falls back when no hints', () => {
            const meta = locatorMeta(undefined, 'Hlr', 'hlr', 'id');
            assert.equal(meta.tag, 'hlr');
            assert.equal(meta.idAttr, 'id');
        });
    });

    describe('leafLocator', () => {
        it('returns id-based locator', () => {
            const loc = leafLocator({ tag: 'hlr', idAttr: 'id' }, 'HLR-001');
            assert.deepEqual(loc, { tag: 'hlr', value: 'HLR-001' });
        });
        it('returns attr-based locator for non-id attrs', () => {
            const loc = leafLocator({ tag: 'test', idAttr: 'name' }, 'test_x');
            assert.deepEqual(loc, { tag: 'test', attr: 'name', value: 'test_x' });
        });
        it('returns undefined for empty value', () => {
            assert.equal(leafLocator({ tag: 'hlr', idAttr: 'id' }, ''), undefined);
        });
    });

    describe('tracesForForm', () => {
        it('filters and maps traces', () => {
            const result = tracesForForm([
                { target: 'HLR', ref: 'HLR-001' },
                { target: undefined, ref: 'x' },
                { target: 'SDD', ref: '2.1' },
            ] as any);
            assert.equal(result.length, 2);
            assert.deepEqual(result[0], { target: 'HLR', ref: 'HLR-001' });
        });
        it('returns empty for undefined', () => {
            assert.deepEqual(tracesForForm(undefined), []);
        });
    });

    describe('propagateBadgeSeverity', () => {
        it('propagates error from child to parent', () => {
            const nodes: TreeNodeDescriptor[] = [{
                label: 'parent',
                collapsible: true,
                children: [
                    { label: '\u274c child', collapsible: false },
                    { label: 'ok child', collapsible: false },
                ],
            }];
            propagateBadgeSeverity(nodes);
            assert.equal(nodes[0].icon, 'error');
        });
        it('sets warning icon on leaf', () => {
            const nodes: TreeNodeDescriptor[] = [
                { label: '\u26a0 warn', collapsible: false },
            ];
            propagateBadgeSeverity(nodes);
            assert.equal(nodes[0].icon, 'warning');
        });
        it('propagates warning from child to parent', () => {
            const nodes: TreeNodeDescriptor[] = [{
                label: 'parent',
                collapsible: true,
                children: [
                    { label: '\u26a0 child', collapsible: false },
                    { label: 'ok child', collapsible: false },
                ],
            }];
            propagateBadgeSeverity(nodes);
            assert.equal(nodes[0].icon, 'warning');
            assert.equal(nodes[0].iconColor, 'list.warningForeground');
        });
    });

    describe('decorateAiTargetable', () => {
        it('marks nodes whose tag has AI actions', () => {
            const hints: UiHintsIndex = {
                Hlr: {
                    tree_node: { label: '@id', id_attr: 'id', group: 'hlrs' },
                    form: [], lenses: [], document: false, element: 'hlr',
                    ai_actions: ['draft.hlr'],
                },
            };
            const nodes: TreeNodeDescriptor[] = [
                { label: 'HLR-001', collapsible: false, locator: { tag: 'hlr', value: 'HLR-001' } },
                { label: 'STP', collapsible: false, locator: { tag: 'stp', value: '' } },
            ];
            decorateAiTargetable(nodes, hints);
            assert.equal(nodes[0].aiTargetable, true);
            assert.equal(nodes[1].aiTargetable, undefined);
        });
    });

    describe('buildTopLevelDescriptors', () => {
        it('builds all top-level groups', () => {
            const project: ParsedProject = {
                hlrs: [{ number: 1, title: 'S1', hlrs: [{ id: 'HLR-001', name: 'A' }] }],
                llrs: [{ number: 1, name: 'f1', llrs: [{ id: 'LLR-C-01' }] }],
                tests: [{ path: 't.py', tests: [{ name: 'test_a' }] }],
                sdd: { modules: [{ path: 'src/x.ts', title: 'X' }] },
            } as unknown as ParsedProject;
            const nodes = buildTopLevelDescriptors(project, undefined);
            const labels = nodes.map(n => n.label);
            assert.ok(labels.some(l => l.startsWith('HLRs')));
            assert.ok(labels.some(l => l.startsWith('LLRs')));
            assert.ok(labels.some(l => l.startsWith('Tests')));
            assert.ok(labels.some(l => l.startsWith('SDD')));
            assert.ok(labels.some(l => l.startsWith('STP')));
        });
    });

    describe('buildGenericPayloadDescriptors', () => {
        it('skips covered type keys', () => {
            const project = {
                _nodes: { Hlr: [], Plan: [{ attrs: { version: '1.0' }, ui: null }] },
                _ui_hints_index: {
                    Hlr: { tree_node: { label: '@id', id_attr: 'id', group: 'hlrs' }, form: [], lenses: [], document: false, element: 'hlr' },
                    Plan: { tree_node: { label: '@version', id_attr: 'version', group: 'plan' }, form: [], lenses: [], document: false, element: 'plan' },
                },
            } as unknown as ParsedProject;
            const nodes = buildGenericPayloadDescriptors(project);
            assert.equal(nodes.length, 1);
            assert.ok(nodes[0].label.startsWith('Plan'));
        });
    });

    describe('COVERED_TYPE_KEYS', () => {
        it('includes the four legacy types', () => {
            assert.ok(COVERED_TYPE_KEYS.has('Hlr'));
            assert.ok(COVERED_TYPE_KEYS.has('Llr'));
            assert.ok(COVERED_TYPE_KEYS.has('Test'));
            assert.ok(COVERED_TYPE_KEYS.has('SddModule'));
        });
    });
});
