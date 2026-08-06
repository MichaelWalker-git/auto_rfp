import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { DocxFormEditor } from '../DocxFormEditor';
import type { DetectedFormField, DocxFillStrategy, RequiredFormItem } from '@auto-rfp/core';

// ─── Mocks ───

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(''),
}));

const mockApiMutate = jest.fn();
const mockApiFetcher = jest.fn();
jest.mock('@/lib/hooks/api-helpers', () => ({
  apiMutate: (...args: unknown[]) => mockApiMutate(...args),
  apiFetcher: (...args: unknown[]) => mockApiFetcher(...args),
  buildApiUrl: (path: string) => path,
}));

jest.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/components/permission-wrapper', () => ({ __esModule: true, usePermission: () => true }));
jest.mock('@/components/ui/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialog: () => null }),
}));
jest.mock('@/components/ui/delete-button', () => ({ PermissionDeleteButton: () => null }));
jest.mock('dompurify', () => ({ __esModule: true, default: { sanitize: (s: string) => s } }));

beforeEach(() => {
  jest.clearAllMocks();
  // The editor fetches rendered HTML from /required-forms/render on mount.
  mockApiFetcher.mockResolvedValue({ html: '<p>Rendered document</p>' });
});

const field = (over: Partial<DetectedFormField>): DetectedFormField => ({
  fieldId: 'field-1',
  label: 'Company Name',
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

const buildDoc = (strategy: DocxFillStrategy | null, fields: DetectedFormField[]): RequiredFormItem => ({
  formId: 'form-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  name: 'Data Security Addendum',
  formType: 'DOCX_FORM',
  status: 'READY',
  sourceFileName: 'addendum.docx',
  sourceFileKey: 'org-1/proj-1/opp-1/addendum.docx',
  sourcePageRange: null,
  sourceSheetName: null,
  docxFillStrategy: strategy,
  fields,
  filledFileKey: null,
  autoFillPercentage: 0,
  manualFieldCount: 0,
  totalFieldCount: fields.length,
  reviewRequired: false,
  reviewedBy: null,
  reviewedAt: null,
  errorMessage: null,
  attachedToProposal: false,
  attachedAt: null,
  proposalDocumentId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('DocxFormEditor — text-token note', () => {
  it('shows the fill-placeholders note for TEXT_TOKEN forms', () => {
    render(<DocxFormEditor doc={buildDoc('TEXT_TOKEN', [field({ docxAnchor: { kind: 'TEXT_TOKEN', ref: '[X]', occurrence: null, sourceLabel: 'X' } })])} orgId="org-1" />);
    expect(screen.getByText(/fills the placeholders in your original document/i)).toBeTruthy();
  });

  it('warns about manual-only fields when some have no placeholder anchor', () => {
    render(
      <DocxFormEditor
        doc={buildDoc('TEXT_TOKEN', [
          field({ fieldId: 'a', label: 'Supplier', docxAnchor: { kind: 'TEXT_TOKEN', ref: '[S]', occurrence: null, sourceLabel: 'S' } }),
          field({ fieldId: 'b', label: 'Signature', docxAnchor: null }),
        ])}
        orgId="org-1"
      />,
    );
    expect(screen.getByText(/must be completed manually/i)).toBeTruthy();
  });

  it('does NOT show the text-token note for IN_PLACE forms', () => {
    render(<DocxFormEditor doc={buildDoc('IN_PLACE', [field({})])} orgId="org-1" />);
    expect(screen.queryByText(/fills the placeholders/i)).toBeNull();
  });

  it('does NOT show the note when strategy is null (legacy record)', () => {
    render(<DocxFormEditor doc={buildDoc(null, [field({})])} orgId="org-1" />);
    expect(screen.queryByText(/fills the placeholders/i)).toBeNull();
  });

  it('renders the field list with labels', () => {
    render(<DocxFormEditor doc={buildDoc('TEXT_TOKEN', [field({ label: 'Company Name' })])} orgId="org-1" />);
    expect(screen.getByText('Company Name')).toBeTruthy();
  });

  it('renders a CHECKBOX field as a clickable toggle (button, not text input)', () => {
    render(
      <DocxFormEditor
        doc={buildDoc('TEXT_TOKEN', [
          field({ fieldId: 'cb', label: 'Corporation', markType: 'CHECKBOX', docxAnchor: { kind: 'CHECKBOX', ref: 'Corporation', occurrence: 0, sourceLabel: 'Corporation' } }),
        ])}
        orgId="org-1"
      />,
    );
    // The option label is shown inside a button (toggle), and there is no text
    // input for it (checkboxes are ticked, not typed).
    const toggle = screen.getByRole('button', { name: /Corporation/i });
    expect(toggle).toBeTruthy();
  });

  it('fetches and renders the sanitized document HTML on mount', async () => {
    mockApiFetcher.mockResolvedValueOnce({ html: '<p>Signature block goes here</p>' });
    render(<DocxFormEditor doc={buildDoc('TEXT_TOKEN', [field({})])} orgId="org-1" />);
    expect(await screen.findByText('Signature block goes here')).toBeTruthy();
    // The render call targets the /render endpoint.
    expect(mockApiFetcher).toHaveBeenCalledWith(expect.stringContaining('/required-forms/render'));
  });

  it('decorates injected markers into field spans showing the live value', async () => {
    // Marker U+E000{0}U+E001 at the fill spot; spot[0] matches the field's anchor.
    const marker = String.fromCharCode(0xe000) + '0' + String.fromCharCode(0xe001);
    mockApiFetcher.mockResolvedValueOnce({
      html: `<p>Name: ${marker}</p>`,
      spots: [{ kind: 'TEXT_LABEL', ref: 'Name:', occurrence: 0, label: 'Name:' }],
    });
    const doc = buildDoc('TEXT_TOKEN', [
      field({ fieldId: 'f1', label: 'Name:', value: 'Jane Doe', docxAnchor: { kind: 'TEXT_LABEL', ref: 'Name:', occurrence: 0, sourceLabel: 'Name:' } }),
    ]);
    const { container } = render(<DocxFormEditor doc={doc} orgId="org-1" />);

    // The marker is replaced by a field span that shows the field's value.
    const span = await waitFor(() => {
      const el = container.querySelector('.af-field[data-af-field-id="f1"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(span.textContent).toContain('Jane Doe');
    expect(span.className).toContain('af-field--filled');
    // Raw marker characters must not leak into the visible text.
    expect(container.textContent).not.toContain(String.fromCharCode(0xe000));
  });
});
