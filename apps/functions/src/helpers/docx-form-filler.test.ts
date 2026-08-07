import JSZip from 'jszip';

const mockSend = jest.fn();
const mockUpload = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  GetObjectCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

jest.mock('./s3', () => ({
  uploadToS3: (...args: unknown[]) => mockUpload(...args),
}));

process.env.DOCUMENTS_BUCKET = 'docs-bucket';

import { fillDocxForm } from './docx-form-filler';
import type { DetectedFormField } from '@auto-rfp/core';

// Minimal DetectedFormField with sane DOCX defaults; override per test.
const makeField = (over: Partial<DetectedFormField>): DetectedFormField => ({
  fieldId: 'fld-1',
  label: 'Field',
  value: null,
  status: 'EMPTY',
  confidence: null,
  profileFieldKey: null,
  manualReason: null,
  pageNumber: null,
  cellReference: null,
  sheetName: null,
  sheetIndex: null,
  boundingBox: null,
  markType: 'TEXT',
  markChar: null,
  markGeometry: null,
  matrixCategory: null,
  matrixFeature: null,
  matrixColumn: 'OTHER',
  docxAnchor: null,
  ...over,
});

const buildDocx = async (body: string): Promise<Uint8Array> => {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'uint8array' });
};

// Same-line label blanks are detected per PARAGRAPH, so filler fixtures for
// TEXT_LABEL must wrap each label in its own <w:p> (as real signature blocks do).
const para = (inner: string): string => `<w:p>${inner}</w:p>`;

// Read the document.xml out of the buffer passed to uploadToS3.
const uploadedDocumentXml = async (): Promise<string> => {
  const body = mockUpload.mock.calls[0][2] as Buffer;
  const zip = await JSZip.loadAsync(body);
  return (await zip.file('word/document.xml')?.async('string')) ?? '';
};

const mockSource = (bytes: Uint8Array) => {
  mockSend.mockResolvedValueOnce({ Body: { transformToByteArray: async () => bytes } });
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fillDocxForm — IN_PLACE', () => {
  it('writes a value into the SDT content control matching the anchor id', async () => {
    const bytes = await buildDocx(
      '<w:sdt><w:sdtPr><w:id w:val="777"/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>placeholder</w:t></w:r></w:sdtContent></w:sdt>',
    );
    mockSource(bytes);

    await fillDocxForm({
      sourceFileKey: 'src.docx',
      strategy: 'IN_PLACE',
      outputKey: 'filled.docx',
      formName: 'Form',
      fields: [makeField({ value: 'Acme Corp', docxAnchor: { kind: 'SDT', ref: '777', sourceLabel: 'Company' } })],
    });

    const xml = await uploadedDocumentXml();
    expect(xml).toContain('Acme Corp');
    expect(xml).not.toContain('placeholder');
    // Run formatting (<w:b/>) is preserved.
    expect(xml).toContain('<w:b/>');
    expect(mockUpload).toHaveBeenCalledWith(
      'docs-bucket',
      'filled.docx',
      expect.any(Buffer),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('escapes XML-special characters in the value', async () => {
    const bytes = await buildDocx(
      '<w:sdt><w:sdtPr><w:id w:val="1"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt>',
    );
    mockSource(bytes);
    await fillDocxForm({
      sourceFileKey: 'src.docx', strategy: 'IN_PLACE', outputKey: 'o.docx', formName: 'F',
      fields: [makeField({ value: 'A & B <Co>', docxAnchor: { kind: 'SDT', ref: '1', sourceLabel: null } })],
    });
    const xml = await uploadedDocumentXml();
    expect(xml).toContain('A &amp; B &lt;Co&gt;');
  });

  it('writes the mark char for a checked checkbox field', async () => {
    const bytes = await buildDocx(
      '<w:sdt><w:sdtPr><w:id w:val="9"/><w:checkbox/></w:sdtPr><w:sdtContent><w:r><w:t></w:t></w:r></w:sdtContent></w:sdt>',
    );
    mockSource(bytes);
    await fillDocxForm({
      sourceFileKey: 'src.docx', strategy: 'IN_PLACE', outputKey: 'o.docx', formName: 'F',
      fields: [makeField({ markType: 'CHECKBOX', value: 'true', markChar: 'X', docxAnchor: { kind: 'SDT', ref: '9', sourceLabel: null } })],
    });
    const xml = await uploadedDocumentXml();
    expect(xml).toContain('<w:t xml:space="preserve">X</w:t>');
  });

  it('fills a legacy FORMTEXT field by bookmark name', async () => {
    const bytes = await buildDocx(
      '<w:bookmarkStart w:id="0" w:name="Vendor"/><w:r><w:t>___</w:t></w:r><w:bookmarkEnd w:id="0"/>',
    );
    mockSource(bytes);
    await fillDocxForm({
      sourceFileKey: 'src.docx', strategy: 'IN_PLACE', outputKey: 'o.docx', formName: 'F',
      fields: [makeField({ value: 'Globex', docxAnchor: { kind: 'LEGACY_FORMFIELD', ref: 'Vendor', sourceLabel: 'Vendor' } })],
    });
    const xml = await uploadedDocumentXml();
    expect(xml).toContain('Globex');
  });

  it('leaves unanchored or empty fields untouched', async () => {
    const bytes = await buildDocx(
      '<w:sdt><w:sdtPr><w:id w:val="5"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>keep</w:t></w:r></w:sdtContent></w:sdt>',
    );
    mockSource(bytes);
    await fillDocxForm({
      sourceFileKey: 'src.docx', strategy: 'IN_PLACE', outputKey: 'o.docx', formName: 'F',
      fields: [
        makeField({ value: '', docxAnchor: { kind: 'SDT', ref: '5', sourceLabel: null } }), // empty → skip
        makeField({ value: 'orphan', docxAnchor: null }), // no anchor → skip
      ],
    });
    const xml = await uploadedDocumentXml();
    expect(xml).toContain('keep');
    expect(xml).not.toContain('orphan');
  });
});

describe('fillDocxForm — TEXT_TOKEN', () => {
  it('replaces a bracket placeholder token in the original run, preserving surrounding text', async () => {
    const bytes = await buildDocx(
      '<w:p><w:r><w:t xml:space="preserve">between the University and </w:t></w:r>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>[INSERT SUPPLIER NAME]</w:t></w:r>' +
        '<w:r><w:t xml:space="preserve"> under this Addendum.</w:t></w:r></w:p>',
    );
    mockSource(bytes);

    await fillDocxForm({
      sourceFileKey: 'src.docx', strategy: 'TEXT_TOKEN', outputKey: 'filled.docx', formName: 'Addendum',
      fields: [makeField({
        value: 'Globex LLC',
        docxAnchor: { kind: 'TEXT_TOKEN', ref: '[INSERT SUPPLIER NAME]', sourceLabel: 'Supplier Name' },
      })],
    });

    const xml = await uploadedDocumentXml();
    expect(xml).toContain('Globex LLC');
    expect(xml).not.toContain('[INSERT SUPPLIER NAME]');
    // Surrounding prose and the run's formatting survive.
    expect(xml).toContain('between the University and');
    expect(xml).toContain('under this Addendum.');
    expect(xml).toContain('<w:b/>');
  });

  it('replaces every occurrence of a repeated token', async () => {
    const bytes = await buildDocx(
      '<w:r><w:t>[CO]</w:t></w:r><w:r><w:t xml:space="preserve"> and again [CO]</w:t></w:r>',
    );
    mockSource(bytes);
    await fillDocxForm({
      sourceFileKey: 'src.docx', strategy: 'TEXT_TOKEN', outputKey: 'o.docx', formName: 'F',
      fields: [makeField({ value: 'Acme', docxAnchor: { kind: 'TEXT_TOKEN', ref: '[CO]', sourceLabel: 'CO' } })],
    });
    const xml = await uploadedDocumentXml();
    expect(xml).not.toContain('[CO]');
    expect((xml.match(/Acme/g) ?? []).length).toBe(2);
  });

  it('escapes XML-special characters in a token value', async () => {
    const bytes = await buildDocx('<w:r><w:t>[NAME]</w:t></w:r>');
    mockSource(bytes);
    await fillDocxForm({
      sourceFileKey: 'src.docx', strategy: 'TEXT_TOKEN', outputKey: 'o.docx', formName: 'F',
      fields: [makeField({ value: 'A & B <Co>', docxAnchor: { kind: 'TEXT_TOKEN', ref: '[NAME]', sourceLabel: null } })],
    });
    const xml = await uploadedDocumentXml();
    expect(xml).toContain('A &amp; B &lt;Co&gt;');
  });

  it('leaves the original untouched when a token field has no value (manual completion)', async () => {
    const bytes = await buildDocx('<w:r><w:t>[INSERT SUPPLIER NAME]</w:t></w:r>');
    mockSource(bytes);
    await fillDocxForm({
      sourceFileKey: 'src.docx', strategy: 'TEXT_TOKEN', outputKey: 'o.docx', formName: 'F',
      fields: [makeField({ value: null, docxAnchor: { kind: 'TEXT_TOKEN', ref: '[INSERT SUPPLIER NAME]', sourceLabel: null } })],
    });
    const xml = await uploadedDocumentXml();
    // Placeholder stays so the user can complete it manually.
    expect(xml).toContain('[INSERT SUPPLIER NAME]');
  });
});

describe('fillDocxForm — TEXT_LABEL (per-occurrence label blanks)', () => {
  // A signature block with "Name:" twice — University (occ 0) then Supplier (occ 1).
  // Each label is its own paragraph, as real signature blocks are.
  const twoNameBlock = () =>
    buildDocx(
      para('<w:r><w:t>Name:</w:t></w:r><w:r><w:t xml:space="preserve">  </w:t></w:r>') +
        para('<w:r><w:t>Name:</w:t></w:r><w:r><w:t xml:space="preserve">  </w:t></w:r>'),
    );

  it('fills only the targeted occurrence; the other stays an empty blank', async () => {
    mockSource(await twoNameBlock());
    await fillDocxForm({
      sourceFileKey: 'src.docx', strategy: 'TEXT_TOKEN', outputKey: 'o.docx', formName: 'F',
      fields: [
        // User filled the Supplier name (occurrence 1) and left the University one (0) blank.
        makeField({ fieldId: 'a', value: null, docxAnchor: { kind: 'TEXT_LABEL', ref: 'Name:', occurrence: 0, sourceLabel: 'University — Name:' } }),
        makeField({ fieldId: 'b', value: 'Jane Doe', docxAnchor: { kind: 'TEXT_LABEL', ref: 'Name:', occurrence: 1, sourceLabel: 'Supplier — Name:' } }),
      ],
    });
    const xml = await uploadedDocumentXml();
    // The filled occurrence carries the value...
    expect(xml).toContain('Name: Jane Doe');
    expect((xml.match(/Name: Jane Doe/g) ?? []).length).toBe(1);
    // ...and occurrence 0 stays a bare label blank ("Name:" with nothing after it).
    expect(xml).toContain('<w:t>Name:</w:t>');
  });

  it('fills the first occurrence when occurrence is 0', async () => {
    mockSource(await twoNameBlock());
    await fillDocxForm({
      sourceFileKey: 'src.docx', strategy: 'TEXT_TOKEN', outputKey: 'o.docx', formName: 'F',
      fields: [makeField({ value: 'Regent Roe', docxAnchor: { kind: 'TEXT_LABEL', ref: 'Name:', occurrence: 0, sourceLabel: 'University — Name:' } })],
    });
    const xml = await uploadedDocumentXml();
    expect(xml).toContain('Name: Regent Roe');
    expect((xml.match(/Name: Regent Roe/g) ?? []).length).toBe(1);
  });

  it('preserves the label run formatting when filling', async () => {
    const bytes = await buildDocx(para('<w:r><w:rPr><w:b/></w:rPr><w:t>Title:</w:t></w:r>'));
    mockSource(bytes);
    await fillDocxForm({
      sourceFileKey: 'src.docx', strategy: 'TEXT_TOKEN', outputKey: 'o.docx', formName: 'F',
      fields: [makeField({ value: 'CEO', docxAnchor: { kind: 'TEXT_LABEL', ref: 'Title:', occurrence: 0, sourceLabel: 'Title:' } })],
    });
    const xml = await uploadedDocumentXml();
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('Title: CEO');
  });

  it('does nothing when the targeted occurrence does not exist', async () => {
    mockSource(await twoNameBlock());
    await fillDocxForm({
      sourceFileKey: 'src.docx', strategy: 'TEXT_TOKEN', outputKey: 'o.docx', formName: 'F',
      fields: [makeField({ value: 'Ghost', docxAnchor: { kind: 'TEXT_LABEL', ref: 'Name:', occurrence: 5, sourceLabel: 'Name:' } })],
    });
    const xml = await uploadedDocumentXml();
    expect(xml).not.toContain('Ghost');
  });
});
