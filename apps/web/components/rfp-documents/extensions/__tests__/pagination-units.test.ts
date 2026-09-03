/**
 * Tests for how the pagination sweep splits the document into units.
 *
 * The bug this guards against: a table or list treated as one block gets pushed
 * whole to the next page, leaving a hole the size of the remaining page that the
 * user can see but not delete.
 */

import { Schema, type Node as PMNode } from '@tiptap/pm/model';
import { collectLayoutUnits, intrinsicHeights, spacerHeightWithin } from '../pagination-units';
import { computePageLayout } from '../pagination-layout';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: {},
    paragraph: { group: 'block', content: 'text*' },
    pageBreak: { group: 'block' },
    table: { group: 'block', content: 'tableRow+' },
    tableRow: { content: 'tableCell+' },
    tableCell: { content: 'paragraph+' },
    bulletList: { group: 'block', content: 'listItem+' },
    orderedList: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph+' },
  },
});

const p = (text = 'x') => schema.node('paragraph', null, text ? [schema.text(text)] : []);
const cell = () => schema.node('tableCell', null, [p()]);
const row = () => schema.node('tableRow', null, [cell()]);
const table = (rows: number) =>
  schema.node('table', null, Array.from({ length: rows }, row));
const item = () => schema.node('listItem', null, [p()]);
const list = (items: number, type: 'bulletList' | 'orderedList' = 'bulletList') =>
  schema.node(type, null, Array.from({ length: items }, item));
const doc = (...blocks: PMNode[]) => schema.node('doc', null, blocks);

const typeAt = (d: PMNode, pos: number) => d.nodeAt(pos)?.type.name;

describe('collectLayoutUnits', () => {
  it('treats plain blocks as single units keyed on their own position', () => {
    const d = doc(p('a'), p('b'));

    const units = collectLayoutUnits(d);

    expect(units).toEqual([
      { measurePos: 0, spacerPos: 0, isExplicitBreak: false },
      { measurePos: 3, spacerPos: 3, isExplicitBreak: false },
    ]);
  });

  it('flags explicit page breaks', () => {
    const d = doc(p('a'), schema.node('pageBreak'));

    expect(collectLayoutUnits(d)[1]).toMatchObject({ isExplicitBreak: true });
  });

  it('splits a table into one unit per row', () => {
    const d = doc(p('a'), table(3));
    const tablePos = 3;

    const units = collectLayoutUnits(d);

    expect(units).toHaveLength(4);
    const rows = units.slice(1);
    for (const unit of rows) {
      expect(typeAt(d, unit.measurePos)).toBe('tableRow');
    }
    // First row pushed → spacer goes before the table, not inside it.
    expect(rows[0].spacerPos).toBe(tablePos);
    // Later rows pushed → spacer goes right before that row.
    expect(rows[1].spacerPos).toBe(rows[1].measurePos);
    expect(rows[2].spacerPos).toBe(rows[2].measurePos);
  });

  it('splits bullet and ordered lists into one unit per item', () => {
    const d = doc(list(2), list(2, 'orderedList'));

    const units = collectLayoutUnits(d);

    expect(units).toHaveLength(4);
    for (const unit of units) {
      expect(typeAt(d, unit.measurePos)).toBe('listItem');
    }
    expect(units[0].spacerPos).toBe(0);
    expect(units[2].spacerPos).toBe(d.child(0).nodeSize);
  });

  it('gives a table row a spacer inside the table when it is the one that overflows', () => {
    const d = doc(p('intro'), table(3));
    const units = collectLayoutUnits(d);
    // intro paragraph 800px, rows 100px each on a 912px page.
    const heights = [800, 100, 100, 100];

    const { spacers } = computePageLayout(
      units.map((u, i) => ({ pos: u.spacerPos, height: heights[i], isExplicitBreak: u.isExplicitBreak })),
      { contentAreaPx: 912, pitchPx: 1056, startOffsetPx: 0 },
    );

    // Row 1 fits (800 + 99 < 912); row 2 would straddle, so the gap sits before it.
    expect(spacers).toHaveLength(1);
    expect(spacers[0].pos).toBe(units[2].spacerPos);
    expect(typeAt(d, spacers[0].pos)).toBe('tableRow');
    expect(spacers[0].height).toBe(1056 - 900);
  });
});

describe('spacerHeightWithin', () => {
  it('sums spacers whose top lies in the half-open range', () => {
    const spacers = [
      { top: 10, height: 5 },
      { top: 50, height: 7 },
      { top: 100, height: 9 },
    ];

    expect(spacerHeightWithin(spacers, 10, 100)).toBe(12);
    expect(spacerHeightWithin(spacers, 11, 100)).toBe(7);
    expect(spacerHeightWithin(spacers, 0, 10)).toBe(0);
  });
});

describe('intrinsicHeights', () => {
  it('uses deltas between tops, minus any spacer in between', () => {
    const units = [
      { top: 72, height: 100 },
      { top: 472, height: 50 },
      { top: 522, height: 30 },
    ];
    const spacers = [{ top: 172, height: 300 }];

    expect(intrinsicHeights(units, spacers)).toEqual([100, 50, 30]);
  });

  it('is a fixed point — re-measuring with the spacers applied returns the same heights', () => {
    const base = [
      { top: 0, height: 100 },
      { top: 100, height: 100 },
    ];
    const first = intrinsicHeights(base, []);
    const withSpacer = [
      { top: 0, height: 100 },
      { top: 300, height: 100 },
    ];

    expect(intrinsicHeights(withSpacer, [{ top: 100, height: 200 }])).toEqual(first);
  });

  it('never returns a negative height', () => {
    expect(intrinsicHeights([{ top: 10, height: 5 }, { top: 0, height: 5 }], [])).toEqual([0, 5]);
  });
});
