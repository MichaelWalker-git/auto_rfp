/**
 * Which pieces of the document the pagination sweep treats as indivisible.
 *
 * ## The problem this solves
 *
 * The sweep used to paginate top-level blocks only, so a table or a list was one
 * unit. A 500px table that did not fit in the remaining 300px of a page was pushed
 * whole onto the next page, leaving a 300px hole the user could see but not delete
 * (spacers are view-only decorations, and they are recomputed on every edit). Word
 * and Google Docs split tables by row and lists by item; so does this.
 *
 * This module is DOM-free so it can be unit tested directly. The extension turns
 * the units into measured blocks and hands them to `computePageLayout`.
 */

import type { Node as PMNode } from '@tiptap/pm/model';

/** Containers that may be split, mapped to the child node they split on. */
export const SPLITTABLE_CONTAINERS: Readonly<Record<string, string>> = {
  table: 'tableRow',
  bulletList: 'listItem',
  orderedList: 'listItem',
};

export interface LayoutUnit {
  /** Position of the node whose DOM is measured (`view.nodeDOM`). */
  measurePos: number;
  /**
   * Where a spacer goes if this unit is pushed to the next page. For the first
   * child of a container that is the container itself, so the gap lands before
   * the table or list rather than inside it as an empty first row.
   */
  spacerPos: number;
  isExplicitBreak: boolean;
}

/** Flatten the document into the units the sweep may push independently. */
export const collectLayoutUnits = (doc: PMNode): LayoutUnit[] => {
  const units: LayoutUnit[] = [];

  doc.forEach((node, offset) => {
    const childType = SPLITTABLE_CONTAINERS[node.type.name];
    const splittable =
      childType !== undefined &&
      node.childCount > 0 &&
      node.child(0).type.name === childType;

    if (splittable) {
      node.forEach((_child, childOffset, index) => {
        const childPos = offset + 1 + childOffset;
        units.push({
          measurePos: childPos,
          spacerPos: index === 0 ? offset : childPos,
          isExplicitBreak: false,
        });
      });
      return;
    }

    units.push({
      measurePos: offset,
      spacerPos: offset,
      isExplicitBreak: node.type.name === 'pageBreak',
    });
  });

  return units;
};

export interface MeasuredRect {
  /** Top edge relative to the editor root, in CSS px. */
  top: number;
  height: number;
}

/** Total height of spacers whose top edge lies in `[from, to)`. */
export const spacerHeightWithin = (
  spacers: readonly MeasuredRect[],
  from: number,
  to: number,
): number =>
  spacers.reduce((sum, s) => (s.top >= from && s.top < to ? sum + s.height : sum), 0);

/**
 * Recover each unit's height as it would be with no spacers applied.
 *
 * Heights are deltas between consecutive tops rather than `offsetHeight` plus
 * margins, because adjacent block margins collapse and summing them double-counts.
 * Subtracting the spacers that currently sit between two units is what makes the
 * layout a fixed point: without it the sweep sees content as already laid out,
 * removes the spacers, then re-adds them on the next pass, forever.
 */
export const intrinsicHeights = (
  units: readonly MeasuredRect[],
  spacers: readonly MeasuredRect[],
): number[] =>
  units.map((unit, i) => {
    const next = units[i + 1];
    if (!next) return Math.max(0, unit.height);
    return Math.max(0, next.top - unit.top - spacerHeightWithin(spacers, unit.top, next.top));
  });
