import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { XlsxFormEditor } from '../XlsxFormEditor';
import type { RequiredFormItem } from '@auto-rfp/core';

// ─── Mocks ───

const mockApiMutate = jest.fn();
const mockApiFetcher = jest.fn();
jest.mock('@/lib/hooks/api-helpers', () => ({
  apiMutate: (...args: unknown[]) => mockApiMutate(...args),
  apiFetcher: (...args: unknown[]) => mockApiFetcher(...args),
  buildApiUrl: (path: string) => path,
}));

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('@/components/permission-wrapper', () => ({
  __esModule: true,
  usePermission: () => true,
}));

jest.mock('@/components/ui/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialog: () => null }),
}));

jest.mock('@/components/ui/delete-button', () => ({
  PermissionDeleteButton: () => null,
}));

// Controlled workbook. `sheetNamesRef` is swapped per test so we can exercise
// both the "one data sheet" and "two data sheets" cases against the same mock.
const workbookState: { SheetNames: string[]; Sheets: Record<string, { __rows: unknown[][] }> } = {
  SheetNames: [],
  Sheets: {},
};
jest.mock('xlsx', () => ({
  read: () => workbookState,
  utils: {
    sheet_to_json: (sheet: { __rows: unknown[][] }) => sheet.__rows,
    encode_cell: ({ r, c }: { r: number; c: number }) =>
      `${String.fromCharCode(65 + c)}${r + 1}`,
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockApiMutate.mockResolvedValue({ url: 'https://s3.example/file.xlsx' });
  global.fetch = jest.fn().mockResolvedValue({
    arrayBuffer: async () => new ArrayBuffer(8),
  }) as unknown as typeof fetch;
  // Default: instructions on sheet 1, the matrix on sheet 2.
  workbookState.SheetNames = ['Instructions', 'Compliance'];
  workbookState.Sheets = {
    Instructions: { __rows: [['Read the instructions here.']] },
    Compliance: {
      __rows: [
        ['Feature', 'Fully Meets'],
        ['MFA support', ''],
      ],
    },
  };
});

const buildDoc = (): RequiredFormItem => ({
  formId: 'form-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  name: 'Attachment A',
  formType: 'XLSX_MATRIX',
  status: 'READY',
  sourceFileName: 'attachment-a.xlsx',
  sourceFileKey: 'org-1/proj-1/opp-1/attachment-a.xlsx',
  sourcePageRange: null,
  sourceSheetName: 'Compliance',
  // The extracted field lives on the SECOND sheet (B2 on "Compliance").
  fields: [
    {
      fieldId: 'field-1',
      label: 'MFA support — Fully Meets',
      value: null,
      status: 'MANUAL_REQUIRED',
      confidence: null,
      profileFieldKey: null,
      manualReason: 'Compliance determination requires manual review',
      pageNumber: null,
      cellReference: 'B2',
      sheetName: 'Compliance',
      sheetIndex: 1,
      boundingBox: null,
      markType: 'TEXT',
      markChar: null,
      markGeometry: null,
      matrixCategory: null,
      matrixFeature: 'MFA support',
      matrixColumn: 'FULLY_MEETS',
    },
  ],
  filledFileKey: null,
  autoFillPercentage: 0,
  manualFieldCount: 1,
  totalFieldCount: 1,
  reviewRequired: true,
  reviewedBy: null,
  reviewedAt: null,
  errorMessage: null,
  attachedToProposal: false,
  attachedAt: null,
  proposalDocumentId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('XlsxFormEditor — multipage support', () => {
  it('builds the grid from the second sheet when fields live there (not an empty sheet-1 grid)', async () => {
    render(<XlsxFormEditor doc={buildDoc()} orgId="org-1" />);

    // The feature text from the Compliance sheet appears in the grid once the
    // async XLSX load resolves — proving the grid was built from sheet 2, not
    // the instructions sheet (which would render an empty grid).
    await waitFor(() => {
      expect(screen.getByText('MFA support')).toBeTruthy();
    });
    // The editable B2 cell renders its "click to edit" affordance in the grid.
    expect(screen.getAllByText('click to edit').length).toBeGreaterThan(0);
  });

  it('does not render a tab bar when only one sheet owns fields', async () => {
    render(<XlsxFormEditor doc={buildDoc()} orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('MFA support')).toBeTruthy();
    });
    // Instructions sheet has no fields, so it never becomes a tab; with a single
    // data sheet the tab bar is suppressed entirely.
    expect(screen.queryByRole('button', { name: 'Instructions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Compliance' })).toBeNull();
  });

  it('renders a tab per data sheet when more than one sheet owns fields', async () => {
    // Two data sheets, plus an instructions sheet with none.
    workbookState.SheetNames = ['Instructions', 'Compliance', 'Pricing'];
    workbookState.Sheets = {
      Instructions: { __rows: [['Read me']] },
      Compliance: { __rows: [['Feature', 'Fully Meets'], ['MFA support', '']] },
      Pricing: { __rows: [['Item', 'Cost'], ['License', '']] },
    };
    const doc = buildDoc();
    doc.fields = [
      ...doc.fields,
      {
        ...doc.fields[0],
        fieldId: 'field-2',
        label: 'License — Cost',
        cellReference: 'B2',
        sheetName: 'Pricing',
        sheetIndex: 2,
        matrixFeature: 'License',
      },
    ];

    render(<XlsxFormEditor doc={doc} orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Compliance' })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Pricing' })).toBeTruthy();
    // The instructions sheet still gets no tab.
    expect(screen.queryByRole('button', { name: 'Instructions' })).toBeNull();
  });

  it('lists the sheet-2 field in the sidebar', async () => {
    render(<XlsxFormEditor doc={buildDoc()} orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('MFA support — Fully Meets')).toBeTruthy();
    });
  });
});
