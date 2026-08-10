'use client';

import { useMemo } from 'react';
import type { PageFurniture } from '@auto-rfp/core';
import { cn } from '@/lib/utils';
import { renderFurnitureBandHtml } from '../lib/render-band';
import { useResolvedFurnitureImages } from '../hooks/useResolvedFurnitureImages';

interface FurniturePreviewProps {
  /** The band to preview. */
  value: PageFurniture;
  className?: string;
}

/**
 * Renders a header/footer band roughly as it will appear in the exported document.
 *
 * ## Why this exists
 *
 * The content field is a raw-HTML textarea, so an uploaded logo appears there as
 * `<img src="s3key:KEY">`. `s3key:` is an internal placeholder that only the export
 * path resolves, so the browser cannot render it and the editor looked broken even
 * though the image was uploaded and does render in the PDF/DOCX output.
 *
 * ## Two invariants
 *
 * 1. **Resolution is display-only.** Presigned URLs are never written back into
 *    the stored HTML — the `s3key:` form has to survive the save, or templates
 *    would persist URLs that expire.
 * 2. **Macros are shown, not resolved.** They resolve at generation time against a
 *    project/opportunity that does not exist yet in the template editor, so they
 *    render as labelled chips. `{{PAGE_NUMBER}}`/`{{TOTAL_PAGES}}` get `#`/`##`
 *    because the renderer computes them per page.
 */
export const FurniturePreview = ({ value, className }: FurniturePreviewProps) => {
  // Resolution goes through the shared presign cache; see useResolvedFurnitureImages.
  const { resolved, failedKeys } = useResolvedFurnitureImages([value.html]);

  const maxImgPx = Math.max(8, Math.round(value.heightIn * 96));

  // No page context here: the strip previews a band, not a specific page, so the
  // page tokens stay as chips rather than claiming a number.
  const renderedHtml = useMemo(
    () => renderFurnitureBandHtml(value.html, { resolved, failedKeys }),
    [value.html, resolved, failedKeys],
  );

  const align = value.align.toLowerCase();

  return (
    <div className={cn('rounded-md border border-border bg-muted/30 px-2 py-1.5', className)}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Preview
        </span>
        {/*
          The template canvas cannot show running furniture — ProseMirror is one
          continuous text stream, so a page's "margin" is really the previous
          page's body text. This strip is therefore the only place it is shown,
          and it has to say that the band repeats.
        */}
        <span className="text-[9px] text-muted-foreground/70">repeats on every page</span>
      </div>
      <div
        data-testid="furniture-preview-content"
        className="furniture-preview text-[11px] leading-snug text-muted-foreground"
        style={{
          textAlign: align as 'left' | 'center' | 'right',
          // Drives the image height cap in the scoped <style> below.
          ['--furniture-img-max' as string]: `${maxImgPx}px`,
        }}
        // Sanitized above with DOMPurify; chips are text-only spans.
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />

      {/*
        Scoped presentation matching what the PDF renderer produces: images are
        middle-aligned and capped to the band height, and block children render
        inline so "logo + company name" reads as one line.

        A plain <style> tag with class-scoped selectors, matching the precedent in
        rich-text-editor.tsx:1526 — styled-jsx is not used anywhere in this app.
      */}
      <style>{`
        .furniture-preview img {
          display: inline-block;
          vertical-align: middle;
          max-height: var(--furniture-img-max, 48px);
          max-width: 100%;
          width: auto;
          height: auto;
          object-fit: contain;
          margin: 0 6px 0 0;
        }
        .furniture-preview .furniture-img-stub {
          display: inline-block;
          vertical-align: middle;
          margin: 0 6px 0 0;
          padding: 0 4px;
          border: 1px dashed var(--border);
          border-radius: 2px;
          font-size: 9px;
          font-style: italic;
          opacity: 0.7;
        }
        .furniture-preview .furniture-img-stub[data-state='failed'] {
          border-color: var(--destructive);
          color: var(--destructive);
          opacity: 1;
        }
        .furniture-preview p,
        .furniture-preview div,
        .furniture-preview h1,
        .furniture-preview h2,
        .furniture-preview h3,
        .furniture-preview h4 {
          display: inline;
          margin: 0;
          padding: 0;
          font-size: inherit;
          font-weight: inherit;
        }
        .furniture-preview .furniture-chip {
          display: inline-block;
          padding: 0 4px;
          border-radius: 3px;
          background: color-mix(in oklab, var(--primary) 12%, transparent);
          color: var(--primary);
          font-size: 10px;
          font-weight: 500;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
};
