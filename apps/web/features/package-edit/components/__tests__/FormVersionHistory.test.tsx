import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DetectedFormField } from '@auto-rfp/core';

const mockRevert = jest.fn();
let mockVersions: Array<Record<string, unknown>> = [];
let mockCurrentFields: DetectedFormField[] = [];
let mockHasCurrentFields = true;
let mockIsLoadingForm = false;
let mockFormError: Error | null = null;

jest.mock('../../hooks/useFormVersions', () => ({
  useFormVersions: () => ({
    versions: mockVersions,
    currentFields: mockCurrentFields,
    hasCurrentFields: mockHasCurrentFields,
    isLoadingForm: mockIsLoadingForm,
    formError: mockFormError,
    count: mockVersions.length,
    isLoading: false,
    error: null,
    revert: mockRevert,
    refresh: jest.fn(),
  }),
}));

import { FormVersionHistory } from '../FormVersionHistory';

const field = (fieldId: string, value: string | null): DetectedFormField =>
  ({ fieldId, label: fieldId, value, status: 'AUTO_FILLED', confidence: null, profileFieldKey: null,
     manualReason: null, pageNumber: null, cellReference: null, sheetName: null, sheetIndex: null,
     boundingBox: null, markType: 'TEXT', markChar: null, markGeometry: null, matrixCategory: null,
     matrixFeature: null, matrixColumn: 'OTHER', docxAnchor: null }) as DetectedFormField;

const props = { orgId: 'o', projectId: 'p', oppId: 'opp', formId: 'f' };

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentFields = [field('total', '$2.4M')];
  mockHasCurrentFields = true;
  mockIsLoadingForm = false;
  mockFormError = null;
  mockVersions = [
    {
      versionId: 'v1',
      versionNumber: 1,
      source: 'MANUAL',
      createdAt: '2026-08-10T00:00:00.000Z',
      fields: [field('total', '$2.0M')],
    },
  ];
});

describe('FormVersionHistory', () => {
  it('lists versions with source label and a Restore button', () => {
    render(<FormVersionHistory {...props} />);
    expect(screen.getByText('v1')).toBeTruthy();
    expect(screen.getByText('Manual edit')).toBeTruthy();
    expect(screen.getByRole('button', { name: /restore/i })).toBeTruthy();
  });

  it('previews the field diff (current → restored) when a version is expanded', () => {
    render(<FormVersionHistory {...props} />);
    // Expand via the version row toggle.
    fireEvent.click(screen.getByRole('button', { name: /v1/i }));
    expect(screen.getByText(/change 1 field/i)).toBeTruthy();
    expect(screen.getByText('$2.4M')).toBeTruthy(); // current (struck)
    expect(screen.getByText('$2.0M')).toBeTruthy(); // restored
  });

  it('says "no changes" when the version matches the current form', () => {
    mockVersions = [{ ...mockVersions[0], fields: [field('total', '$2.4M')] }];
    render(<FormVersionHistory {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /v1/i }));
    expect(screen.getByText(/make no changes/i)).toBeTruthy();
  });

  it('does NOT show a (wrong) change count while the current form is still loading', () => {
    // Baseline not yet loaded: currentFields is the []-placeholder. Diffing now
    // would falsely report every version field as "added" for a destructive action.
    mockHasCurrentFields = false;
    mockIsLoadingForm = true;
    mockCurrentFields = [];
    render(<FormVersionHistory {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /v1/i }));
    expect(screen.queryByText(/would change/i)).toBeNull();
    expect(screen.queryByText(/make no changes/i)).toBeNull();
  });

  it('shows an error (not a wrong diff) when the current form failed to load', () => {
    mockHasCurrentFields = false;
    mockFormError = new Error('boom');
    mockCurrentFields = [];
    render(<FormVersionHistory {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /v1/i }));
    expect(screen.queryByText(/would change/i)).toBeNull();
    expect(screen.getByText(/changes can't be previewed/i)).toBeTruthy();
  });

  it('reverts to the chosen version', async () => {
    mockRevert.mockResolvedValueOnce(undefined);
    render(<FormVersionHistory {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => expect(mockRevert).toHaveBeenCalledWith(1));
  });

  it('shows an empty state with no versions', () => {
    mockVersions = [];
    render(<FormVersionHistory {...props} />);
    expect(screen.getByText(/No version history yet/i)).toBeTruthy();
  });
});
