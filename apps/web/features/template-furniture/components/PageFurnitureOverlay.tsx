'use client';

import type { PageFurniture, TemplateFurniture } from '@auto-rfp/core';
import { renderFurnitureBandHtml } from '../lib/render-band';

/**
 * Shared styling for both bands, kept in one place so they cannot drift.
 *
 * `overflow-hidden` is a last-resort guard only — images are capped by an explicit
 * px value below, so clipping should never be what limits them.
 */
const BAND_BASE = 'absolute select-none overflow-hidden text-[9px] leading-tight text-gray-400';

interface BandProps {
  part: PageFurniture;
  /** `top` for a header, `bottom` for a footer. */
  edge: 'top' | 'bottom';
  /** Distance from that edge, in px — sits inside the page margin. */
  offsetPx: number;
  /** Horizontal inset matching the page's side margin, in px. */
  insetPx: number;
  /** Max band height in px, derived from the configured `heightIn`. */
  maxHeightPx: number;
  resolved: Record<string, string>;
  failedKeys: Record<string, true>;
  pageNumbers: { current: number; total: number };
}

const FurnitureBand = ({
  part,
  edge,
  offsetPx,
  insetPx,
  maxHeightPx,
  resolved,
  failedKeys,
  pageNumbers,
}: BandProps) => {
  // Real page numbers here, not chips: this overlay is showing a specific page, so
  // "Page 2 of 3" is both possible and what makes it read like Word.
  const html = renderFurnitureBandHtml(part.html, { resolved, failedKeys, pageNumbers });

  return (
    <div
      className={`${BAND_BASE} furniture-band`}
      style={{
        [edge]: `${offsetPx}px`,
        left: `${insetPx}px`,
        right: `${insetPx}px`,
        // A DEFINITE height, not just max-height: a percentage max-height on the
        // child image resolves to `none` against an indefinite parent, which is
        // why large logos rendered full-size and were clipped by overflow.
        height: `${maxHeightPx}px`,
        // Consumed by the `.furniture-band img` rule as an explicit px cap. A px
        // value cannot silently fail the way a percentage does.
        ['--furniture-img-max' as string]: `${maxHeightPx}px`,
        textAlign: part.align.toLowerCase() as 'left' | 'center' | 'right',
      }}
      // Sanitised inside renderFurnitureBandHtml; chips/stubs are text-only spans.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

interface PageFurnitureOverlayProps {
  furniture?: TemplateFurniture;
  /** 0-based page index within the document. */
  pageIndex: number;
  /** Total pages, for `{{TOTAL_PAGES}}`. */
  totalPages: number;
  /** 0-based furniture section this page belongs to. */
  sectionIndex: number;
  /** Page geometry in px, from the editor's PAGE_SIZES. */
  paddingY: number;
  paddingX: number;
  resolved: Record<string, string>;
  failedKeys: Record<string, true>;
}

/**
 * Draws the running header and footer into a single page sheet's margins.
 *
 * ## Why in the canvas
 *
 * Word and Google Docs show headers and footers in the document itself, greyed
 * out, repeating on every page. Ours previously showed them only in a sidebar
 * strip, so a user who configured a header went looking for it on the page and
 * concluded the feature was broken — which happened repeatedly in testing.
 *
 * The editor already renders real page sheets (816×1056px for Letter at 96 DPI)
 * and already draws a page number inside the bottom margin, so the geometry and
 * the precedent both existed; only the furniture was missing.
 *
 * Purely decorative: `pointer-events: none` on the parent sheet and absolute
 * positioning mean this cannot affect editing or pagination, exactly as the
 * existing page-number label doesn't.
 *
 * Per-section overrides are honoured, so a cover page with the header switched
 * off renders clean here too.
 */
export const PageFurnitureOverlay = ({
  furniture,
  pageIndex,
  totalPages,
  sectionIndex,
  paddingY,
  paddingX,
  resolved,
  failedKeys,
}: PageFurnitureOverlayProps) => {
  if (!furniture) return null;

  const override = furniture.sectionOverrides.find((o) => o.sectionIndex === sectionIndex);

  const headerVisible =
    furniture.header.enabled &&
    furniture.header.html.trim().length > 0 &&
    (override?.showHeader ?? true);

  const footerVisible =
    furniture.footer.enabled &&
    furniture.footer.html.trim().length > 0 &&
    (override?.showFooter ?? true);

  if (!headerVisible && !footerVisible) return null;

  const pageNumbers = { current: pageIndex + 1, total: totalPages };
  const inset = Math.max(8, paddingX / 2);

  /**
   * Fit a band inside the page margin and centre it there.
   *
   * The margin is the only space a band may occupy — one pixel past it and the band
   * sits on body text. A fixed offset does not work: measured in Chromium, an offset
   * of `paddingY/2 - 8` (28px) with a 48px band occupied 28..76 inside a 72px margin,
   * overflowing by 4px and colliding with the first paragraph on every page.
   *
   * So the height is capped to the margin (less a small gutter) and the remaining
   * space split evenly above and below.
   */
  const bandBox = (heightIn: number) => {
    const gutter = 8;
    const available = Math.max(0, paddingY - gutter);
    const height = Math.max(1, Math.min(Math.round(heightIn * 96), available));
    return { height, offset: Math.max(4, (paddingY - height) / 2) };
  };

  return (
    <>
      {headerVisible && (
        <FurnitureBand
          part={furniture.header}
          edge="top"
          offsetPx={bandBox(furniture.header.heightIn).offset}
          insetPx={inset}
          maxHeightPx={bandBox(furniture.header.heightIn).height}
          resolved={resolved}
          failedKeys={failedKeys}
          pageNumbers={pageNumbers}
        />
      )}
      {footerVisible && (
        <FurnitureBand
          part={furniture.footer}
          edge="bottom"
          offsetPx={bandBox(furniture.footer.heightIn).offset}
          insetPx={inset}
          maxHeightPx={bandBox(furniture.footer.heightIn).height}
          resolved={resolved}
          failedKeys={failedKeys}
          pageNumbers={pageNumbers}
        />
      )}
    </>
  );
};
