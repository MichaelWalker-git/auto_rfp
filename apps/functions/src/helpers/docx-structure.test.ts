import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import JSZip from 'jszip';

import { detectDocxStructure } from './docx-structure';

// Build a minimal .docx buffer whose word/document.xml wraps the given body.
const buildDocx = async (body: string): Promise<Buffer> => {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
};

const sdt = (props: string, content = '<w:r><w:t>x</w:t></w:r>'): string =>
  `<w:sdt><w:sdtPr>${props}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

// Wrap runs in a paragraph. Same-line label detection requires the label to be
// its OWN paragraph (this is what rejects header/prose "Title: <RFP title>").
const para = (inner: string): string => `<w:p>${inner}</w:p>`;
const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

describe('detectDocxStructure', () => {
  it('classifies a prose document with no controls, tokens or blanks as TEXT_TOKEN with no fields', async () => {
    const buf = await buildDocx('<w:p><w:r><w:t>This section describes the scope of work.</w:t></w:r></w:p>');
    const result = await detectDocxStructure(buf);
    expect(result.strategy).toBe('TEXT_TOKEN');
    expect(result.structuredFields).toHaveLength(0);
  });

  it('detects an inline underscore blank glued to its label ("eMail:____")', async () => {
    const buf = await buildDocx('<w:p><w:r><w:t xml:space="preserve">eMail:______________________</w:t></w:r></w:p>');
    const result = await detectDocxStructure(buf);
    expect(result.strategy).toBe('TEXT_TOKEN');
    expect(result.structuredFields).toHaveLength(1);
    expect(result.structuredFields[0].anchor.kind).toBe('UNDERSCORE_BLANK');
    expect(result.structuredFields[0].label.toLowerCase()).toContain('email');
  });

  it('detects bracketed placeholder tokens as TEXT_TOKEN fields anchored on the literal token', async () => {
    const buf = await buildDocx(
      '<w:p><w:r><w:t xml:space="preserve">between the University and </w:t></w:r>' +
        '<w:r><w:t>[INSERT SUPPLIER NAME]</w:t></w:r>' +
        '<w:r><w:t> under [Title of Agreement].</w:t></w:r></w:p>',
    );
    const result = await detectDocxStructure(buf);
    expect(result.strategy).toBe('TEXT_TOKEN');
    expect(result.structuredFields).toHaveLength(2);
    expect(result.structuredFields[0]).toMatchObject({
      anchor: { kind: 'TEXT_TOKEN', ref: '[INSERT SUPPLIER NAME]' },
      // "INSERT" lead-in stripped for the label.
      label: 'SUPPLIER NAME',
      markType: 'TEXT',
    });
    expect(result.structuredFields[1].anchor.ref).toBe('[Title of Agreement]');
  });

  it('dedupes repeated tokens to one field', async () => {
    const buf = await buildDocx(
      '<w:r><w:t>[INSERT SUPPLIER NAME]</w:t></w:r><w:r><w:t>[INSERT SUPPLIER NAME]</w:t></w:r>',
    );
    const result = await detectDocxStructure(buf);
    expect(result.structuredFields).toHaveLength(1);
  });

  it('ignores non-letter bracket spans (footnote markers, empty checkboxes)', async () => {
    const buf = await buildDocx('<w:r><w:t>text[1] and [ ] and [42]</w:t></w:r>');
    const result = await detectDocxStructure(buf);
    expect(result.structuredFields).toHaveLength(0);
  });

  it('detects label blanks (Name:/Title:/Date:) as per-occurrence TEXT_LABEL fields', async () => {
    // A signature block with the same labels twice, one per party. Each label is
    // its own paragraph (as in real signature blocks).
    const buf = await buildDocx(
      para(run('Regents of the University')) +
        para(run('Name:') + run('  ')) +
        para(run('Title:')) +
        para(run('Supplier')) +
        para(run('Name:')) +
        para(run('Title:')),
    );
    const result = await detectDocxStructure(buf);
    expect(result.strategy).toBe('TEXT_TOKEN');

    const nameFields = result.structuredFields.filter((f) => f.anchor.ref === 'Name:');
    expect(nameFields).toHaveLength(2);
    // Each occurrence is distinctly indexed and carries its section context.
    expect(nameFields[0].anchor).toMatchObject({ kind: 'TEXT_LABEL', ref: 'Name:', occurrence: 0 });
    expect(nameFields[0].label).toMatch(/University/);
    expect(nameFields[1].anchor).toMatchObject({ kind: 'TEXT_LABEL', ref: 'Name:', occurrence: 1 });
    expect(nameFields[1].label).toMatch(/Supplier/);
  });

  it('does not treat a header/prose line containing a colon as a label blank', async () => {
    // "Title: WEBSITE ..." — the colon is followed by content in the SAME
    // paragraph, so it's a header, not a fillable label.
    const buf = await buildDocx(
      para(run('Title:') + '<w:tab/>' + run('WEBSITE REDESIGN AND HOSTING')) +
        para(run('The following terms apply to this agreement:')),
    );
    const result = await detectDocxStructure(buf);
    expect(result.structuredFields).toHaveLength(0);
  });

  it('detects both bracket tokens and label blanks together, in document order', async () => {
    const buf = await buildDocx(
      para(run('Supplier [INSERT SUPPLIER NAME]')) +
        para(run('Name:')) +
        para(run('Date:')),
    );
    const result = await detectDocxStructure(buf);
    const kinds = result.structuredFields.map((f) => f.anchor.kind);
    expect(kinds).toContain('TEXT_TOKEN');
    expect(kinds).toContain('TEXT_LABEL');
  });

  it('prefers structured controls over text tokens when both are present', async () => {
    const buf = await buildDocx(
      sdt('<w:alias w:val="Company"/><w:id w:val="1"/><w:text/>') +
        '<w:r><w:t>[INSERT SUPPLIER NAME]</w:t></w:r>',
    );
    const result = await detectDocxStructure(buf);
    expect(result.strategy).toBe('IN_PLACE');
    expect(result.structuredFields).toHaveLength(1);
    expect(result.structuredFields[0].anchor.kind).toBe('SDT');
  });

  it('detects a w:text content control as an IN_PLACE field with an SDT anchor', async () => {
    const buf = await buildDocx(
      sdt('<w:alias w:val="Company Name"/><w:tag w:val="company"/><w:id w:val="12345"/><w:text/>'),
    );
    const result = await detectDocxStructure(buf);
    expect(result.strategy).toBe('IN_PLACE');
    expect(result.structuredFields).toHaveLength(1);
    expect(result.structuredFields[0]).toMatchObject({
      anchor: { kind: 'SDT', ref: '12345', sourceLabel: 'Company Name' },
      label: 'Company Name',
      markType: 'TEXT',
    });
  });

  it('detects a checkbox content control with CHECKBOX markType', async () => {
    const buf = await buildDocx(
      sdt('<w:tag w:val="agree"/><w:id w:val="999"/><w:checkbox/>'),
    );
    const result = await detectDocxStructure(buf);
    expect(result.strategy).toBe('IN_PLACE');
    expect(result.structuredFields[0].markType).toBe('CHECKBOX');
    // No alias → falls back to the tag as the label.
    expect(result.structuredFields[0].label).toBe('agree');
  });

  it('detects a legacy FORMTEXT form field via its bookmark name', async () => {
    const body =
      '<w:bookmarkStart w:id="0" w:name="Vendor"/>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText>FORMTEXT</w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:bookmarkEnd w:id="0"/>';
    const buf = await buildDocx(body);
    const result = await detectDocxStructure(buf);
    expect(result.strategy).toBe('IN_PLACE');
    expect(result.structuredFields[0]).toMatchObject({
      anchor: { kind: 'LEGACY_FORMFIELD', ref: 'Vendor' },
      markType: 'TEXT',
    });
  });

  it('rejects goog_rdk_* suggestion SDTs (Google Docs artifacts)', async () => {
    // Mirrors the real sample: many suggestion wrappers, no real controls.
    const body = Array.from({ length: 5 }, (_, i) =>
      sdt(`<w:tag w:val="goog_rdk_${i}"/><w:id w:val="${i}"/>`, '<w:r><w:t>,</w:t></w:r>'),
    ).join('');
    const buf = await buildDocx(body);
    const result = await detectDocxStructure(buf);
    // No real controls and no bracket tokens → TEXT_TOKEN with no fields.
    expect(result.strategy).toBe('TEXT_TOKEN');
    expect(result.structuredFields).toHaveLength(0);
  });

  it('rejects structural SDTs (TOC / docPartObj) and plain untyped SDTs', async () => {
    const body =
      sdt('<w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj><w:id w:val="1"/>') +
      sdt('<w:id w:val="2"/>'); // plain, no kind
    const buf = await buildDocx(body);
    const result = await detectDocxStructure(buf);
    expect(result.strategy).toBe('TEXT_TOKEN');
    expect(result.structuredFields).toHaveLength(0);
  });

  it('skips a fillable control that has no stable id anchor', async () => {
    const buf = await buildDocx(sdt('<w:alias w:val="No Id"/><w:text/>'));
    const result = await detectDocxStructure(buf);
    expect(result.structuredFields).toHaveLength(0);
  });

  it('returns TEXT_TOKEN when document.xml is missing', async () => {
    const zip = new JSZip();
    zip.file('word/other.xml', '<x/>');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const result = await detectDocxStructure(buf as Buffer);
    expect(result.strategy).toBe('TEXT_TOKEN');
    expect(result.structuredFields).toHaveLength(0);
  });

  // Real sample (local-only, gitignored). Skips gracefully when absent (CI).
  const samplePath = join(
    __dirname,
    '../../../../docs/example-docs/2025 Data Security Addendum Clean.docx',
  );
  const maybeIt = existsSync(samplePath) ? it : it.skip;
  maybeIt('classifies the real sample as TEXT_TOKEN, finding its bracket placeholders AND signature-block labels (no goog_rdk_* SDTs)', async () => {
    const buf = readFileSync(samplePath);
    const result = await detectDocxStructure(buf);
    // All 15 SDTs are goog_rdk_* suggestions (rejected). Detection is per-run, so
    // it reliably finds the two single-run [INSERT ...] tokens; the split-run
    // [Title of Agreement] is left for manual completion.
    expect(result.strategy).toBe('TEXT_TOKEN');
    const refs = result.structuredFields.map((f) => f.anchor.ref);
    expect(refs).toContain('[INSERT SUPPLIER NAME]');
    expect(refs).toContain('[INSERT DEPARTMENT NAME]');
    // The "By: Name: Title: Date:" signature block (repeated per party) is now
    // captured as per-occurrence TEXT_LABEL fields — the two "Name:" occurrences.
    const nameLabels = result.structuredFields.filter((f) => f.anchor.kind === 'TEXT_LABEL' && f.anchor.ref === 'Name:');
    expect(nameLabels.length).toBeGreaterThanOrEqual(2);
    expect(new Set(nameLabels.map((f) => f.anchor.occurrence)).size).toBe(nameLabels.length); // distinct occurrences
  });
});
