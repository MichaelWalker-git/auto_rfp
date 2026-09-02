// ─── Mocks (before imports) ───────────────────────────────────────────────────

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  UpdateCommand: jest.fn((params: unknown) => ({ __command: 'Update', params })),
}));

const mockSend = jest.fn();
const mockQueryAll = jest.fn();
jest.mock('./db', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  queryAllBySkPrefix: (...args: unknown[]) => mockQueryAll(...args),
  withRetry: (op: () => Promise<unknown>) => op(),
}));

const mockListForms = jest.fn();
jest.mock('./required-form', () => ({
  listRequiredFormsByOpportunity: (...args: unknown[]) => mockListForms(...args),
}));

const mockRollup = jest.fn();
jest.mock('./notary-wiring', () => ({
  rollupOpportunityNotary: (...args: unknown[]) => mockRollup(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import type { NotaryRequirement } from '@auto-rfp/core';
import { SK_NAME } from '../constants/common';
import { markFormsReadyIfAllDone } from './mark-forms-ready';

const readyForm = (formId: string, extra: Record<string, unknown> = {}) => ({
  formId, orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', status: 'READY', ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
  mockRollup.mockResolvedValue(undefined);
  mockQueryAll.mockResolvedValue([]);
});

describe('markFormsReadyIfAllDone — notary rollup wiring (WF-D)', () => {
  it('does NOT run the notary rollup while any form is still pending', async () => {
    mockListForms.mockResolvedValueOnce([readyForm('f1'), readyForm('f2', { status: 'IN_PROGRESS' })]);

    await markFormsReadyIfAllDone('org-1', 'proj-1', 'opp-1');

    expect(mockRollup).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled(); // no FORMS_READY writes either
  });

  it('runs the notary rollup with the forms + unmapped triggers once all forms are terminal', async () => {
    const forms = [readyForm('f1', { notaryStatus: 'REQUIRED' }), readyForm('f2', { status: 'DONE' })];
    mockListForms.mockResolvedValueOnce(forms);
    mockQueryAll.mockResolvedValueOnce([{ [SK_NAME]: 'proj-1#opp-1#qf-1' }]);
    mockSend.mockResolvedValue({});

    const triggers: NotaryRequirement[] = [
      { documentName: 'solicitation', status: 'POSSIBLY_REQUIRED', cue: 'KEYWORD', pageNumber: null, triggeringText: 'notary' },
    ];

    await markFormsReadyIfAllDone('org-1', 'proj-1', 'opp-1', triggers);

    expect(mockRollup).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      forms,
      unmappedTriggers: triggers,
    });
    // FORMS_READY write still happens for the question file.
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('defaults unmapped triggers to [] when the caller passes none (e.g. the Textract callback)', async () => {
    mockListForms.mockResolvedValueOnce([readyForm('f1', { status: 'FAILED' })]);

    await markFormsReadyIfAllDone('org-1', 'proj-1', 'opp-1');

    expect(mockRollup).toHaveBeenCalledWith(expect.objectContaining({ unmappedTriggers: [] }));
  });

  it('never throws even if the notary rollup rejects (best-effort)', async () => {
    mockListForms.mockResolvedValueOnce([readyForm('f1')]);
    mockRollup.mockRejectedValueOnce(new Error('rollup blew up'));

    await expect(markFormsReadyIfAllDone('org-1', 'proj-1', 'opp-1')).resolves.toBeUndefined();
  });
});
