/**
 * DOCX page-furniture tests.
 *
 * These inspect the real .docx produced by `Packer` — a .docx is a zip of OOXML
 * parts, so the assertions read the actual generated XML. That is deliberate:
 * the risky claims here are about OOXML structure (does a section own its own
 * header? is the page number a live field or frozen text?) and only the emitted
 * XML can settle them.
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

import JSZip from 'jszip';
import { TemplateFurnitureSchema, type TemplateFurniture } from '@auto-rfp/core';
import { htmlToDocxBuffer } from './export-docx';

const furniture = (over: Partial<TemplateFurniture> = {}): TemplateFurniture =>
  TemplateFurnitureSchema.parse({
    header: { html: '<p>ACME Corp</p>' },
    footer: { html: '<p>Page {{PAGE_NUMBER}} of {{TOTAL_PAGES}}</p>' },
    ...over,
  });

/**
 * Read and inflate the parts of the generated .docx.
 *
 * A .docx is a ZIP of deflate-compressed OOXML, so entries must be decompressed —
 * searching the raw bytes only ever finds entry names. `jszip` is already present
 * as a `docx` dependency.
 */
const docxParts = async (buf: Buffer): Promise<{ names: string[]; xml: string }> => {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  const xmlParts = await Promise.all(
    names
      .filter((n) => n.endsWith('.xml') || n.endsWith('.rels'))
      .map((n) => zip.files[n].async('string')),
  );
  return { names, xml: xmlParts.join('\n') };
};

const COVER_BODY =
  '<p>Cover</p><div data-page-break="true"></div><p>Body</p><div data-page-break="true"></div><p>Appendix</p>';

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
});

describe('htmlToDocxBuffer — no furniture', () => {
  it('produces no header or footer parts', async () => {
    const { names } = await docxParts(await htmlToDocxBuffer('<p>Body</p>'));
    // Regression guard: existing documents must gain nothing.
    expect(names.some((n) => n.includes('header'))).toBe(false);
    expect(names.some((n) => n.includes('footer'))).toBe(false);
  });

  it('still produces a valid single-section document', async () => {
    const { names } = await docxParts(await htmlToDocxBuffer('<p>Body</p>'));
    expect(names).toContain('word/document.xml');
  });
});

describe('htmlToDocxBuffer — uniform furniture', () => {
  it('emits header and footer parts', async () => {
    const { names } = await docxParts(await htmlToDocxBuffer('<p>Body</p>', { furniture: furniture() }));
    expect(names.some((n) => n.includes('header'))).toBe(true);
    expect(names.some((n) => n.includes('footer'))).toBe(true);
  });

  it('writes the header text into the document', async () => {
    const { xml } = await docxParts(await htmlToDocxBuffer('<p>Body</p>', { furniture: furniture() }));
    expect(xml).toContain('ACME Corp');
  });

  it('renders page numbers as live PAGE/NUMPAGES fields, not frozen text', async () => {
    const { xml } = await docxParts(await htmlToDocxBuffer('<p>Body</p>', { furniture: furniture() }));
    // The whole point of the reserved-token design: Word recomputes these on
    // repagination. Literal digits would go stale on the first edit.
    expect(xml).toContain('PAGE');
    expect(xml).toContain('NUMPAGES');
    expect(xml).not.toContain('{{PAGE_NUMBER}}');
    expect(xml).not.toContain('{{TOTAL_PAGES}}');
  });

  it('grows the section margins to reserve the furniture bands', async () => {
    const { xml } = await docxParts(await htmlToDocxBuffer('<p>Body</p>', { furniture: furniture() }));
    // 1.5in = 2160 twips top and bottom.
    expect(xml).toContain('w:top="2160"');
    expect(xml).toContain('w:bottom="2160"');
  });

  it('keeps the base 1in margin when no furniture is shown', async () => {
    const { xml } = await docxParts(await htmlToDocxBuffer('<p>Body</p>'));
    expect(xml).toContain('w:top="1440"');
  });

  it('uses one section when no override needs more', async () => {
    const { xml } = await docxParts(await htmlToDocxBuffer(COVER_BODY, { furniture: furniture() }));
    // Splitting changes list numbering and TOC behaviour, so avoid it when possible.
    expect((xml.match(/<w:sectPr/g) ?? []).length).toBe(1);
  });
});

describe('htmlToDocxBuffer — per-section overrides', () => {
  it('emits one section per page-break group', async () => {
    const f = furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] });
    const { xml } = await docxParts(await htmlToDocxBuffer(COVER_BODY, { furniture: f }));
    // Cover / body / appendix — the only way OOXML can vary furniture per page group.
    expect((xml.match(/<w:sectPr/g) ?? []).length).toBe(3);
  });

  it('emits a distinct header part per section so the cover can differ', async () => {
    const f = furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] });
    const { names } = await docxParts(await htmlToDocxBuffer(COVER_BODY, { furniture: f }));
    expect(names.filter((n) => /header\d*\.xml$/.test(n)).length).toBeGreaterThan(1);
  });

  it('still shows the footer on a header-suppressed cover', async () => {
    const f = furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] });
    const { xml } = await docxParts(await htmlToDocxBuffer(COVER_BODY, { furniture: f }));
    expect(xml).toContain('NUMPAGES');
  });

  it('keeps all body content across the split', async () => {
    const f = furniture({ sectionOverrides: [{ sectionIndex: 0, showHeader: false }] });
    const { xml } = await docxParts(await htmlToDocxBuffer(COVER_BODY, { furniture: f }));
    // Splitting must not drop a section's content.
    for (const text of ['Cover', 'Body', 'Appendix']) expect(xml).toContain(text);
  });

  it('applies per-section margins independently', async () => {
    const f = furniture({
      sectionOverrides: [{ sectionIndex: 0, showHeader: false, showFooter: false }],
    });
    const { xml } = await docxParts(await htmlToDocxBuffer(COVER_BODY, { furniture: f }));
    // Cover keeps 1in (no furniture); later sections get 1.5in.
    expect(xml).toContain('w:top="1440"');
    expect(xml).toContain('w:top="2160"');
  });
});

describe('htmlToDocxBuffer — furniture images', () => {
  const pngBytes = Buffer.concat([
    Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
    (() => { const b = Buffer.alloc(8); b.writeUInt32BE(200, 0); b.writeUInt32BE(100, 4); return b; })(),
    Buffer.alloc(120, 7),
  ]);

  it('embeds a header logo as a media part', async () => {
    mockSend.mockResolvedValue({
      Body: (async function* () { yield new Uint8Array(pngBytes); })(),
    });
    const f = furniture({
      header: { enabled: true, html: '<img src="s3key:org/logo.png">', align: 'CENTER', heightIn: 0.5 },
    });
    const { names } = await docxParts(await htmlToDocxBuffer('<p>Body</p>', { furniture: f }));
    // If the s3key were left unresolved the image would be skipped silently —
    // this is the guard for that failure mode.
    expect(names.some((n) => n.startsWith('word/media/'))).toBe(true);
  });

  it('does not embed media when the image cannot be fetched', async () => {
    mockSend.mockRejectedValue(new Error('AccessDenied'));
    const f = furniture({
      header: { enabled: true, html: '<img src="s3key:org/logo.png">', align: 'CENTER', heightIn: 0.5 },
    });
    const { names } = await docxParts(await htmlToDocxBuffer('<p>Body</p>', { furniture: f }));
    expect(names.some((n) => n.startsWith('word/media/'))).toBe(false);
  });
});
