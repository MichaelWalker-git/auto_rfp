/**
 * Tests for shared page-furniture rendering.
 *
 * The assertions here encode behaviour that was verified empirically against the
 * real Chromium and `docx` builds (see the feature plan), so they are guarding
 * real constraints rather than restating the implementation:
 *  - furniture images must be inlined as base64, since neither renderer fetches
 *    an unresolved `s3key:` reference;
 *  - margins must grow by the band height, or furniture overprints body text;
 *  - page tokens must survive as renderer-native fields, not literal text.
 */

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  GetObjectCommand: jest.fn((params) => ({ type: 'Get', params })),
  CopyObjectCommand: jest.fn((params) => ({ type: 'Copy', params })),
  DeleteObjectCommand: jest.fn((params) => ({ type: 'Delete', params })),
  DeleteObjectsCommand: jest.fn((params) => ({ type: 'DeleteMany', params })),
  PutObjectCommand: jest.fn((params) => ({ type: 'Put', params })),
}));

process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { TemplateFurnitureSchema, type TemplateFurniture } from '@auto-rfp/core';
import {
  applyPdfPageTokens,
  buildPdfFurnitureTemplates,
  collectFurnitureImageKeys,
  EMPTY_PDF_TEMPLATE,
  groupSectionsByVisibility,
  hasSectionOverrides,
  inlineFurnitureImages,
  marginForFurniture,
  pageContentHeightPx,
  resolveSectionVisibilities,
  splitIntoFurnitureSections,
} from './export-furniture';

const furniture = (over: Partial<TemplateFurniture> = {}): TemplateFurniture =>
  TemplateFurnitureSchema.parse({
    header: { html: '<p>ACME Corp</p>' },
    footer: { html: '<p>Page {{PAGE_NUMBER}} of {{TOTAL_PAGES}}</p>' },
    ...over,
  });

/** A real 1x1 PNG — `fetchImageFromUrl`-style guards reject sub-100-byte buffers. */
const pngBytes = Buffer.concat([
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  Buffer.alloc(120, 7),
]);

const s3Stream = (buf: Buffer) => ({
  Body: (async function* () { yield new Uint8Array(buf); })(),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
});

describe('marginForFurniture', () => {
  it('leaves margins at the base inch when nothing is visible', () => {
    expect(marginForFurniture(undefined, { showHeader: false, showFooter: false }))
      .toEqual({ topIn: 1, bottomIn: 1 });
  });

  it('grows the top margin by the header band height', () => {
    const f = furniture({ header: { enabled: true, html: '<p>H</p>', align: 'CENTER', heightIn: 0.75 } });
    // Without this the running header prints on top of the first line of body text.
    expect(marginForFurniture(f, { showHeader: true, showFooter: false }).topIn).toBe(1.75);
  });

  it('grows only the margins whose furniture is actually shown', () => {
    const f = furniture();
    const m = marginForFurniture(f, { showHeader: false, showFooter: true });
    expect(m.topIn).toBe(1);
    expect(m.bottomIn).toBe(1.5);
  });
});

describe('hasSectionOverrides', () => {
  it('is false with no furniture or no overrides', () => {
    expect(hasSectionOverrides(undefined)).toBe(false);
    expect(hasSectionOverrides(furniture())).toBe(false);
  });

  it('is false when an override only re-affirms visibility', () => {
    // A show:true override needs no extra sections — the default already shows it.
    const f = furniture({ sectionOverrides: [{ sectionIndex: 1, showHeader: true }] });
    expect(hasSectionOverrides(f)).toBe(false);
  });

  it('is true when a section suppresses furniture', () => {
    const f = furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] });
    expect(hasSectionOverrides(f)).toBe(true);
  });
});

describe('splitIntoFurnitureSections', () => {
  it('returns a single section when there are no page breaks', () => {
    expect(splitIntoFurnitureSections('<p>Only</p>')).toEqual(['<p>Only</p>']);
  });

  it('splits on the TipTap page-break node', () => {
    const html = '<p>Cover</p><div data-page-break="true"></div><p>Body</p>';
    expect(splitIntoFurnitureSections(html)).toEqual(['<p>Cover</p>', '<p>Body</p>']);
  });

  it('splits on the legacy page-break class', () => {
    const html = '<p>A</p><div class="page-break-node"></div><p>B</p>';
    expect(splitIntoFurnitureSections(html)).toEqual(['<p>A</p>', '<p>B</p>']);
  });

  it('produces cover / body / appendix for the ticket scenario', () => {
    const html = '<p>Cover</p><div data-page-break="true"></div><p>Body</p><div data-page-break="true"></div><p>Appendix</p>';
    expect(splitIntoFurnitureSections(html)).toHaveLength(3);
  });

  it('never returns an empty list', () => {
    expect(splitIntoFurnitureSections('')).toEqual(['']);
  });
});

describe('resolveSectionVisibilities', () => {
  it('suppresses only the overridden section', () => {
    const f = furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] });
    expect(resolveSectionVisibilities(f, 3)).toEqual([
      { showHeader: false, showFooter: true },
      { showHeader: true, showFooter: true },
      { showHeader: true, showFooter: true },
    ]);
  });

  it('always returns at least one entry', () => {
    expect(resolveSectionVisibilities(furniture(), 0)).toHaveLength(1);
  });
});

describe('applyPdfPageTokens', () => {
  it('maps page tokens to the spans Puppeteer substitutes per page', () => {
    expect(applyPdfPageTokens('Page {{PAGE_NUMBER}} of {{TOTAL_PAGES}}'))
      .toBe('Page <span class="pageNumber"></span> of <span class="totalPages"></span>');
  });

  it('leaves other macro-looking text alone', () => {
    expect(applyPdfPageTokens('{{COMPANY_NAME}}')).toBe('{{COMPANY_NAME}}');
  });
});

describe('collectFurnitureImageKeys', () => {
  it('collects distinct s3 keys across header and footer', () => {
    const keys = collectFurnitureImageKeys(
      '<img src="s3key:org/logo.png">',
      '<img src="s3key:org/seal.png"><img src="s3key:org/logo.png">',
    );
    expect(keys.sort()).toEqual(['org/logo.png', 'org/seal.png']);
  });

  it('returns nothing for HTML without s3 images', () => {
    expect(collectFurnitureImageKeys('<p>text</p>', '')).toEqual([]);
  });
});

describe('inlineFurnitureImages', () => {
  it('replaces an s3key reference with a base64 data URI', async () => {
    mockSend.mockResolvedValueOnce(s3Stream(pngBytes));
    const out = await inlineFurnitureImages('<img src="s3key:org/logo.png">');
    // Base64 inlining is mandatory: Puppeteer's header context never fetches URLs.
    expect(out).toContain('src="data:image/png;base64,');
    expect(out).not.toContain('s3key:');
  });

  it('does not call S3 when there are no images', async () => {
    const out = await inlineFurnitureImages('<p>no images</p>');
    expect(out).toBe('<p>no images</p>');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('fetches each distinct key once', async () => {
    mockSend.mockResolvedValue(s3Stream(pngBytes));
    await inlineFurnitureImages('<img src="s3key:a.png"><img src="s3key:a.png">');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('keeps the placeholder visible when the fetch fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
    const out = await inlineFurnitureImages('<img src="s3key:org/logo.png">');
    // Leaving the marker makes a broken logo diagnosable instead of silently blank.
    expect(out).toContain('s3key:org/logo.png');
  });

  it('skips SVG, which DOCX cannot embed', async () => {
    const out = await inlineFurnitureImages('<img src="s3key:org/logo.svg">');
    expect(mockSend).not.toHaveBeenCalled();
    expect(out).toContain('s3key:org/logo.svg');
  });

  it('reads the bucket from the resolved S3 key', async () => {
    mockSend.mockResolvedValueOnce(s3Stream(pngBytes));
    await inlineFurnitureImages('<img src="s3key:org/logo.png">');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ Bucket: 'test-bucket', Key: 'org/logo.png' }),
      }),
    );
  });
});

describe('buildPdfFurnitureTemplates', () => {
  it('returns explicit empty templates when nothing is visible', async () => {
    const t = await buildPdfFurnitureTemplates(undefined, { showHeader: false, showFooter: false });
    // Puppeteer draws its own default furniture unless handed an empty template.
    expect(t.headerTemplate).toBe(EMPTY_PDF_TEMPLATE);
    expect(t.footerTemplate).toBe(EMPTY_PDF_TEMPLATE);
  });

  it('sets an explicit font-size, since Puppeteer defaults to ~6pt', async () => {
    const t = await buildPdfFurnitureTemplates(furniture(), { showHeader: true, showFooter: true });
    expect(t.headerTemplate).toMatch(/font-size:\s*9pt/);
  });

  it('renders page tokens as Puppeteer spans in the footer', async () => {
    const t = await buildPdfFurnitureTemplates(furniture(), { showHeader: true, showFooter: true });
    expect(t.footerTemplate).toContain('class="pageNumber"');
    expect(t.footerTemplate).toContain('class="totalPages"');
    expect(t.footerTemplate).not.toContain('{{PAGE_NUMBER}}');
  });

  it('honours alignment', async () => {
    const f = furniture({ header: { enabled: true, html: '<p>H</p>', align: 'RIGHT', heightIn: 0.5 } });
    const t = await buildPdfFurnitureTemplates(f, { showHeader: true, showFooter: false });
    expect(t.headerTemplate).toMatch(/text-align:\s*right/);
  });

  it('inlines a header image as base64', async () => {
    mockSend.mockResolvedValueOnce(s3Stream(pngBytes));
    const f = furniture({
      header: { enabled: true, html: '<img src="s3key:org/logo.png">', align: 'CENTER', heightIn: 0.5 },
    });
    const t = await buildPdfFurnitureTemplates(f, { showHeader: true, showFooter: false });
    expect(t.headerTemplate).toContain('data:image/png;base64,');
  });

  it('empties only the suppressed half', async () => {
    const t = await buildPdfFurnitureTemplates(furniture(), { showHeader: false, showFooter: true });
    expect(t.headerTemplate).toBe(EMPTY_PDF_TEMPLATE);
    expect(t.footerTemplate).not.toBe(EMPTY_PDF_TEMPLATE);
  });
});

describe('groupSectionsByVisibility', () => {
  it('collapses a uniform document into one render pass', () => {
    const runs = groupSectionsByVisibility([
      { showHeader: true, showFooter: true },
      { showHeader: true, showFooter: true },
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ startSection: 0, endSection: 1 });
  });

  it('splits a suppressed cover from the rest', () => {
    // Two passes, not three: only distinct furniture states cost a render.
    const runs = groupSectionsByVisibility([
      { showHeader: false, showFooter: true },
      { showHeader: true, showFooter: true },
      { showHeader: true, showFooter: true },
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ startSection: 0, endSection: 0, showHeader: false });
    expect(runs[1]).toMatchObject({ startSection: 1, endSection: 2, showHeader: true });
  });

  it('regroups when a later section returns to an earlier state', () => {
    const runs = groupSectionsByVisibility([
      { showHeader: true, showFooter: true },
      { showHeader: false, showFooter: true },
      { showHeader: true, showFooter: true },
    ]);
    expect(runs).toHaveLength(3);
  });

  it('handles a single section', () => {
    expect(groupSectionsByVisibility([{ showHeader: true, showFooter: false }])).toHaveLength(1);
  });
});

describe('pageContentHeightPx', () => {
  it('accounts for the furniture-grown margins', () => {
    // Letter 11in less 1in + 1.5in of margin = 8.5in at 96 DPI.
    expect(pageContentHeightPx('letter', 1, 1.5)).toBe(816);
  });

  it('shrinks as the furniture band grows', () => {
    expect(pageContentHeightPx('letter', 1.5, 1.5))
      .toBeLessThan(pageContentHeightPx('letter', 1, 1));
  });

  it('supports a4', () => {
    expect(pageContentHeightPx('a4', 1, 1)).toBeGreaterThan(800);
  });

  it('never returns a non-positive height', () => {
    expect(pageContentHeightPx('letter', 6, 6)).toBeGreaterThan(0);
  });
});

describe('PDF template layout', () => {
  /**
   * These encode defects found by inspecting a rendered PDF, not by reasoning
   * about the CSS — the unit tests were green while the header was visibly
   * mis-rendered.
   */
  it('insets with padding, not margin, so centred content is not pushed off-page', async () => {
    const t = await buildPdfFurnitureTemplates(furniture(), { showHeader: true, showFooter: false });
    // `margin` on a `width: 100%` box made the container wider than the page and
    // shifted centred furniture to the left.
    expect(t.headerTemplate).toContain('padding: 0 1in');
    expect(t.headerTemplate).toContain('box-sizing: border-box');
    expect(t.headerTemplate).not.toMatch(/margin:\s*0\s+1in/);
  });

  it('middle-aligns images so a logo sits on the text baseline, not above it', async () => {
    const t = await buildPdfFurnitureTemplates(furniture(), { showHeader: true, showFooter: false });
    expect(t.headerTemplate).toContain('vertical-align: middle');
  });

  it('caps image height to the configured band', async () => {
    const f = furniture({
      header: { enabled: true, html: '<img src="x.png">', align: 'CENTER', heightIn: 0.5 },
    });
    const t = await buildPdfFurnitureTemplates(f, { showHeader: true, showFooter: false });
    // 0.5in at 96 DPI — an uncapped logo would overflow into the body text.
    expect(t.headerTemplate).toContain('max-height: 48px');
  });

  it('renders block children inline so "logo + name" is one line', async () => {
    const t = await buildPdfFurnitureTemplates(furniture(), { showHeader: true, showFooter: false });
    expect(t.headerTemplate).toMatch(/\.furniture-inline p[^{]*\{[^}]*display:\s*inline/);
  });

  it('avoids flexbox, which treated the injected <style> as a layout item', async () => {
    const t = await buildPdfFurnitureTemplates(furniture(), { showHeader: true, showFooter: false });
    expect(t.headerTemplate).not.toContain('display: flex');
  });
});
