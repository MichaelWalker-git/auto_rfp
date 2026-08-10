'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import type { PageFurniture } from '@auto-rfp/core';
import { cn } from '@/lib/utils';

/** Matches `src="s3key:KEY"` — the placeholder form stored in template HTML. */
const S3_KEY_SRC_RE = /src="s3key:([^"]+)"/g;

/** Matches a macro token, e.g. `{{COMPANY_NAME}}`. */
const MACRO_RE = /\{\{(\w+)\}\}/g;

/** Tokens the renderer resolves per page, so no fixed value can be previewed. */
const PAGE_TOKEN_LABELS: Record<string, string> = {
  PAGE_NUMBER: '#',
  TOTAL_PAGES: '##',
};

/** `COMPANY_NAME` → `COMPANY NAME`, for a readable chip. */
const humanizeToken = (token: string): string => token.replace(/_/g, ' ');

interface FurniturePreviewProps {
  /** The band to preview. */
  value: PageFurniture;
  /** Resolves an S3 key to a temporary viewable URL. */
  onGetDownloadUrl?: (key: string) => Promise<string>;
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
export const FurniturePreview = ({ value, onGetDownloadUrl, className }: FurniturePreviewProps) => {
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [failedKeys, setFailedKeys] = useState<Record<string, true>>({});
  // Keys already requested, so a re-render never re-presigns the same image.
  const requestedRef = useRef<Set<string>>(new Set());

  const html = value.html;

  const keys = useMemo(() => {
    const found = new Set<string>();
    for (const match of html.matchAll(S3_KEY_SRC_RE)) found.add(match[1]);
    return [...found];
  }, [html]);

  // Debounced so typing does not fire a presign request per keystroke.
  useEffect(() => {
    if (!onGetDownloadUrl) return;
    const pending = keys.filter((k) => !requestedRef.current.has(k));
    if (!pending.length) return;

    const timer = setTimeout(() => {
      pending.forEach((key) => requestedRef.current.add(key));
      void Promise.all(
        pending.map(async (key) => {
          try {
            const url = await onGetDownloadUrl(key);
            setResolved((prev) => ({ ...prev, [key]: url }));
          } catch {
            // Surface the failure rather than rendering a silently blank box —
            // mirrors the export path, which keeps an unresolvable placeholder.
            setFailedKeys((prev) => ({ ...prev, [key]: true }));
          }
        }),
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [keys, onGetDownloadUrl]);

  const maxImgPx = Math.max(8, Math.round(value.heightIn * 96));

  const renderedHtml = useMemo(() => {
    // Sanitize first: the content is user-authored and goes through
    // dangerouslySetInnerHTML. Chips are injected afterwards as text-only spans,
    // so they cannot introduce markup. Same ordering as DocxFormEditor.
    const safe = DOMPurify.sanitize(html);

    // An unresolved image must NOT keep an empty `src` — a browser renders that as
    // its broken-image glyph (a "?" box), which reads as an error rather than a
    // pending state. Swap the whole <img> for a styled span instead.
    const withImages = safe.replace(/<img\b[^>]*src="s3key:([^"]+)"[^>]*>/g, (whole, key: string) => {
      const url = resolved[key];
      if (url) return whole.replace(`src="s3key:${key}"`, `src="${url}"`);
      const state = failedKeys[key] ? 'failed' : 'loading';
      const title = failedKeys[key] ? 'Image could not be loaded' : 'Loading image…';
      return `<span class="furniture-img-stub" data-state="${state}" title="${title}">${
        failedKeys[key] ? 'image unavailable' : 'image…'
      }</span>`;
    });

    return withImages.replace(MACRO_RE, (_whole, token: string) => {
      const pageLabel = PAGE_TOKEN_LABELS[token];
      const label = pageLabel ?? humanizeToken(token);
      return `<span class="furniture-chip" data-macro="${token}">‹${label}›</span>`;
    });
  }, [html, resolved, failedKeys]);

  const align = value.align.toLowerCase();

  return (
    <div className={cn('rounded-md border border-border bg-muted/30 px-2 py-1.5', className)}>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Preview
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
          width: auto;
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
