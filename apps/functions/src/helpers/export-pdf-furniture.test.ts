/**
 * PDF page-furniture tests.
 *
 * These render real PDFs through headless Chromium. That is deliberate and not
 * over-engineering: every load-bearing assumption in this feature was a claim
 * about Chromium behaviour, and two of them turned out to be false in ways no
 * mock could have caught —
 *
 *  1. `@page` margin-box CSS cannot suppress Puppeteer's `headerTemplate`
 *     (output was byte-identical with and without the rules), which is why
 *     per-section furniture is done by rendering page ranges and merging.
 *  2. Measuring section positions with `offsetTop` reported page 1 for every
 *     section, because the markers are zero-height inside a padded body.
 *
 * A regression in either would produce a plausible-looking PDF with the header on
 * the cover page, so the assertions check the rendered artifact.
 *
 * Skipped automatically when no local Chrome is present (e.g. CI without it) —
 * `@sparticuz/chromium` ships a Linux-only binary that cannot exec on macOS.
 */

const LOCAL_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  GetObjectCommand: jest.fn(),
  CopyObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  DeleteObjectsCommand: jest.fn(),
  PutObjectCommand: jest.fn(),
}));

jest.mock('@sparticuz/chromium', () => ({
  args: ['--no-sandbox'],
  executablePath: async () => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}));

process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { TemplateFurnitureSchema, type TemplateFurniture } from '@auto-rfp/core';
import { htmlToPdfBuffer } from './export-pdf';

const hasChrome = fs.existsSync(LOCAL_CHROME);
const describeIfChrome = hasChrome ? describe : describe.skip;

if (!hasChrome) {
  // Surface the skip rather than silently reporting a green run.
  console.warn('[export-pdf-furniture] Local Chrome not found — skipping real-render PDF tests');
}

/** Cover / body / appendix — the scenario the per-page toggle exists for. */
const BODY = [
  '<h1>Cover</h1><p>cover text</p>',
  '<div data-page-break="true"></div>',
  '<h1>Body</h1><p>body text</p>',
  '<div data-page-break="true"></div>',
  '<h1>Appendix</h1><p>appendix text</p>',
].join('');

const furniture = (over: Partial<TemplateFurniture> = {}): TemplateFurniture =>
  TemplateFurnitureSchema.parse({
    header: { html: '<p>ACME CORP PROPOSAL</p>' },
    footer: { html: '<p>Page {{PAGE_NUMBER}} of {{TOTAL_PAGES}}</p>' },
    ...over,
  });

const pageCount = async (buf: Buffer): Promise<number> =>
  (await PDFDocument.load(buf)).getPageCount();

/** Byte size of each page in isolation — a proxy for how much is drawn on it. */
const perPageSizes = async (buf: Buffer): Promise<number[]> => {
  const doc = await PDFDocument.load(buf);
  const sizes: number[] = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    const single = await PDFDocument.create();
    const [pg] = await single.copyPages(doc, [i]);
    single.addPage(pg);
    sizes.push((await single.save()).length);
  }
  return sizes;
};

describeIfChrome('htmlToPdfBuffer — page furniture', () => {
  jest.setTimeout(180_000);

  it('produces the same page count with and without furniture', async () => {
    const plain = await htmlToPdfBuffer(BODY, { title: 'T' });
    const withFurniture = await htmlToPdfBuffer(BODY, { title: 'T', furniture: furniture() });

    // Furniture lives in the margin box; it must never add or drop a page.
    expect(await pageCount(withFurniture)).toBe(await pageCount(plain));
  });

  it('adds rendered content when furniture is enabled', async () => {
    const plain = await htmlToPdfBuffer(BODY, { title: 'T' });
    const withFurniture = await htmlToPdfBuffer(BODY, { title: 'T', furniture: furniture() });
    expect(withFurniture.length).toBeGreaterThan(plain.length);
  });

  it('leaves output unchanged in page count when no furniture is configured', async () => {
    const plain = await htmlToPdfBuffer(BODY, { title: 'T' });
    expect(await pageCount(plain)).toBe(3);
  });

  it('suppresses furniture on the cover page only', async () => {
    const uniform = await htmlToPdfBuffer(BODY, { title: 'T', furniture: furniture() });
    const coverOff = await htmlToPdfBuffer(BODY, {
      title: 'T',
      furniture: furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false, showFooter: false }] }),
    });

    const uniformSizes = await perPageSizes(uniform);
    const coverOffSizes = await perPageSizes(coverOff);

    // Page 1 loses its header and footer...
    expect(coverOffSizes[0]).toBeLessThan(uniformSizes[0]);
    // ...while the body pages keep theirs. Allow slack for font subsetting
    // differences between render passes.
    expect(coverOffSizes[1]).toBeGreaterThan(uniformSizes[1] * 0.9);
  });

  it('keeps the page count intact when merging per-section renders', async () => {
    const plain = await htmlToPdfBuffer(BODY, { title: 'T' });
    const coverOff = await htmlToPdfBuffer(BODY, {
      title: 'T',
      furniture: furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] }),
    });

    // Regression guard: an off-by-one in the page-range maths duplicated a
    // boundary page and turned 3 pages into 4.
    expect(await pageCount(coverOff)).toBe(await pageCount(plain));
  });

  it('supports suppressing the footer on a trailing appendix section', async () => {
    const plain = await htmlToPdfBuffer(BODY, { title: 'T' });
    const appendixOff = await htmlToPdfBuffer(BODY, {
      title: 'T',
      furniture: furniture({ sectionOverrides: [{ sectionIndex: 2, showFooter: false }] }),
    });
    expect(await pageCount(appendixOff)).toBe(await pageCount(plain));
  });

  it('renders a document with no page breaks correctly', async () => {
    const single = await htmlToPdfBuffer('<h1>Only</h1><p>text</p>', {
      title: 'T',
      furniture: furniture(),
    });
    expect(await pageCount(single)).toBe(1);
  });
});
