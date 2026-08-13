import { hasGrandfatheredDocument, isGeneratedDocument, type GateDocumentLike } from '../gating';

const doc = (over: Partial<GateDocumentLike> = {}): GateDocumentLike => ({
  documentType: 'TECHNICAL_PROPOSAL',
  htmlContentKey: null,
  content: null,
  fileKey: null,
  originalFileName: null,
  ...over,
});

describe('isGeneratedDocument', () => {
  it('counts documents with an htmlContentKey', () => {
    expect(isGeneratedDocument(doc({ htmlContentKey: 'org/key.html' }))).toBe(true);
  });

  it('counts legacy documents with inline content and no file fields', () => {
    expect(isGeneratedDocument(doc({ content: { title: 'T', content: '<p>x</p>' } }))).toBe(true);
  });

  it('does not count uploaded files', () => {
    expect(
      isGeneratedDocument(
        doc({ content: { title: 'T' }, fileKey: 'uploads/nda.pdf', originalFileName: 'nda.pdf' }),
      ),
    ).toBe(false);
  });

  it('does not count placeholders without content', () => {
    expect(isGeneratedDocument(doc())).toBe(false);
  });
});

describe('hasGrandfatheredDocument', () => {
  it('is true when a gated-type generated document exists', () => {
    expect(
      hasGrandfatheredDocument([doc(), doc({ htmlContentKey: 'org/key.html' })]),
    ).toBe(true);
  });

  it('ignores generated documents of exempt types', () => {
    expect(
      hasGrandfatheredDocument([
        doc({ documentType: 'QUESTIONS_AND_ANSWERS', htmlContentKey: 'org/key.html' }),
        doc({ documentType: 'QUESTIONNAIRE', htmlContentKey: 'org/key2.html' }),
      ]),
    ).toBe(false);
  });

  it('ignores gated-type documents that were never generated', () => {
    expect(
      hasGrandfatheredDocument([
        doc(),
        doc({ fileKey: 'uploads/file.pdf', originalFileName: 'file.pdf', content: { title: 'T' } }),
      ]),
    ).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(hasGrandfatheredDocument([])).toBe(false);
  });
});
