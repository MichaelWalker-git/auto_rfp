/**
 * Macro resolution for page furniture.
 *
 * Regression guard: header/footer HTML was originally snapshotted onto the
 * document verbatim, so a `{{COMPANY_NAME}}` in a header printed as the literal
 * text `{{COMPANY_NAME}}` on every page of the PDF. Body content went through
 * `replaceMacros`; furniture did not.
 *
 * The reserved page tokens must survive untouched — they are resolved later by
 * each renderer as a live page-number field, because page numbers do not exist
 * until pagination.
 */

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

const mockGetTemplate = jest.fn();
const mockFindBestTemplate = jest.fn();

jest.mock('@/helpers/template', () => ({
  getTemplate: (...args: unknown[]) => mockGetTemplate(...args),
  findBestTemplate: (...args: unknown[]) => mockFindBestTemplate(...args),
  loadTemplateHtml: jest.fn(),
  // The real implementation — the point of these tests is its token behaviour.
  replaceMacros: jest.requireActual('@/helpers/template').replaceMacros,
}));

jest.mock('@/helpers/db', () => ({ queryBySkPrefix: jest.fn() }));
jest.mock('@/helpers/rfp-document', () => ({
  updateRFPDocumentMetadata: jest.fn(),
  uploadRFPDocumentHtml: jest.fn(),
  getRFPDocument: jest.fn(),
}));
jest.mock('@/helpers/executive-opportunity-brief', () => ({ loadAllSolicitationTexts: jest.fn() }));

process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { TemplateFurnitureSchema } from '@auto-rfp/core';
import { resolveTemplateFurniture } from './document-generation';

const MACROS = {
  COMPANY_NAME: 'ACME Corp',
  PROJECT_TITLE: 'Cloud Migration',
  PROPOSAL_TITLE: 'Cloud Migration',
};

const templateWith = (headerHtml: string, footerHtml: string) => ({
  id: 'tpl-1',
  furniture: TemplateFurnitureSchema.parse({
    header: { html: headerHtml },
    footer: { html: footerHtml },
  }),
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('resolveTemplateFurniture', () => {
  it('resolves ordinary macros in the header', async () => {
    mockGetTemplate.mockResolvedValue(templateWith('<p>{{COMPANY_NAME}}</p>', '<p>x</p>'));

    const { furniture } = await resolveTemplateFurniture('org-1', 'COVER_LETTER', 'tpl-1', MACROS);

    expect(furniture?.header.html).toBe('<p>ACME Corp</p>');
    expect(furniture?.header.html).not.toContain('{{COMPANY_NAME}}');
  });

  it('resolves a document title in the footer', async () => {
    mockGetTemplate.mockResolvedValue(templateWith('<p>h</p>', '<p>{{PROPOSAL_TITLE}}</p>'));

    const { furniture } = await resolveTemplateFurniture('org-1', 'COVER_LETTER', 'tpl-1', MACROS);

    // "Footer supports dynamic variables (page number, total pages, document title)."
    expect(furniture?.footer.html).toBe('<p>Cloud Migration</p>');
  });

  it('leaves page tokens for the renderer to turn into live fields', async () => {
    mockGetTemplate.mockResolvedValue(
      templateWith('<p>h</p>', '<p>Page {{PAGE_NUMBER}} of {{TOTAL_PAGES}}</p>'),
    );

    const { furniture } = await resolveTemplateFurniture('org-1', 'COVER_LETTER', 'tpl-1', MACROS);

    // Resolving these here would freeze the number at export time.
    expect(furniture?.footer.html).toContain('{{PAGE_NUMBER}}');
    expect(furniture?.footer.html).toContain('{{TOTAL_PAGES}}');
  });

  it('mixes resolved macros and surviving page tokens in one footer', async () => {
    mockGetTemplate.mockResolvedValue(
      templateWith('<p>h</p>', '<p>{{COMPANY_NAME}} · Page {{PAGE_NUMBER}}</p>'),
    );

    const { furniture } = await resolveTemplateFurniture('org-1', 'COVER_LETTER', 'tpl-1', MACROS);

    expect(furniture?.footer.html).toBe('<p>ACME Corp · Page {{PAGE_NUMBER}}</p>');
  });

  it('preserves alignment, height and overrides while rewriting html', async () => {
    mockGetTemplate.mockResolvedValue({
      id: 'tpl-1',
      furniture: TemplateFurnitureSchema.parse({
        header: { html: '<p>{{COMPANY_NAME}}</p>', align: 'RIGHT', heightIn: 0.75 },
        footer: { html: '<p>f</p>' },
        sectionOverrides: [{ sectionIndex: 0, showHeader: false }],
      }),
    });

    const { furniture } = await resolveTemplateFurniture('org-1', 'COVER_LETTER', 'tpl-1', MACROS);

    expect(furniture?.header.align).toBe('RIGHT');
    expect(furniture?.header.heightIn).toBe(0.75);
    expect(furniture?.sectionOverrides).toEqual([{ sectionIndex: 0, showHeader: false }]);
  });

  it('leaves html untouched when no macro values are supplied', async () => {
    mockGetTemplate.mockResolvedValue(templateWith('<p>{{COMPANY_NAME}}</p>', '<p>f</p>'));

    const { furniture } = await resolveTemplateFurniture('org-1', 'COVER_LETTER', 'tpl-1');

    expect(furniture?.header.html).toBe('<p>{{COMPANY_NAME}}</p>');
  });

  it('keeps an unknown macro visible rather than blanking it', async () => {
    mockGetTemplate.mockResolvedValue(templateWith('<p>{{NOT_A_MACRO}}</p>', '<p>f</p>'));

    const { furniture } = await resolveTemplateFurniture('org-1', 'COVER_LETTER', 'tpl-1', MACROS);

    // A visible placeholder is debuggable; a silently empty header is not.
    expect(furniture?.header.html).toBe('<p>{{NOT_A_MACRO}}</p>');
  });

  it('returns the templateId but no furniture when the template has none', async () => {
    mockGetTemplate.mockResolvedValue({ id: 'tpl-1' });

    const result = await resolveTemplateFurniture('org-1', 'COVER_LETTER', 'tpl-1', MACROS);

    expect(result.templateId).toBe('tpl-1');
    expect(result.furniture).toBeUndefined();
  });

  it('falls back to the best template when no id is given', async () => {
    mockFindBestTemplate.mockResolvedValue(templateWith('<p>{{COMPANY_NAME}}</p>', '<p>f</p>'));

    const { furniture } = await resolveTemplateFurniture('org-1', 'COVER_LETTER', undefined, MACROS);

    expect(mockFindBestTemplate).toHaveBeenCalledWith('org-1', 'COVER_LETTER');
    expect(furniture?.header.html).toBe('<p>ACME Corp</p>');
  });

  it('returns empty when no template is found', async () => {
    mockGetTemplate.mockResolvedValue(null);
    expect(await resolveTemplateFurniture('org-1', 'COVER_LETTER', 'tpl-1', MACROS)).toEqual({});
  });

  it('never fails generation when the lookup throws', async () => {
    mockGetTemplate.mockRejectedValue(new Error('DynamoDB unavailable'));
    // A document without a header beats no document at all.
    expect(await resolveTemplateFurniture('org-1', 'COVER_LETTER', 'tpl-1', MACROS)).toEqual({});
  });
});
