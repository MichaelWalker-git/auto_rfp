/**
 * Regression tests for createLinearTicket (helpers/linear.ts).
 *
 * The bug this guards: when no LINEAR_DEFAULT_ASSIGNEE_ID is configured, the
 * helper used to send `assigneeId: ''` to Linear, which rejects it with
 * "assigneeId must be a UUID". The error was swallowed by the catch and
 * surfaced to the caller as a missing API key. createIssue must therefore be
 * called WITHOUT an assigneeId key when we have no assignee.
 */

// Env vars are read at module load — set them before importing the helper.
process.env.LINEAR_TEAM_ID = 'team-uuid';
process.env.LINEAR_PROJECT_ID = 'project-uuid';
delete process.env.LINEAR_DEFAULT_ASSIGNEE_ID;

const mockCreateIssue = jest.fn();
const mockTeam = jest.fn();

jest.mock('@linear/sdk', () => ({
  LinearClient: jest.fn(() => ({
    createIssue: (...a: unknown[]) => mockCreateIssue(...a),
    team: (...a: unknown[]) => mockTeam(...a),
  })),
}));

const mockGetApiKey = jest.fn();
jest.mock('./api-key-storage', () => ({
  getApiKey: (...a: unknown[]) => mockGetApiKey(...a),
}));

import { createLinearTicket } from './linear';

const createdIssue = { id: 'issue-1', identifier: 'HOR-1', url: 'https://linear.app/x' };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetApiKey.mockResolvedValue('lin_api_test');
  mockCreateIssue.mockResolvedValue({ issue: Promise.resolve(createdIssue) });
  // Labels lookup — no labels resolve, mirrors the real workspace.
  mockTeam.mockResolvedValue({ labels: async () => ({ nodes: [] }) });
});

describe('createLinearTicket', () => {
  it('omits assigneeId entirely when none is configured (regression)', async () => {
    const result = await createLinearTicket({
      orgId: 'org-1',
      title: 'RFP Opportunity',
      description: 'desc',
    });

    expect(result).toEqual({ id: 'issue-1', identifier: 'HOR-1', url: 'https://linear.app/x' });
    expect(mockCreateIssue).toHaveBeenCalledTimes(1);

    const payload = mockCreateIssue.mock.calls[0][0];
    // The key must be absent — never an empty string (Linear requires a UUID).
    expect('assigneeId' in payload).toBe(false);
    expect(payload).toMatchObject({ teamId: 'team-uuid', projectId: 'project-uuid', title: 'RFP Opportunity' });
  });

  it('passes assigneeId through when explicitly provided', async () => {
    await createLinearTicket({
      orgId: 'org-1',
      title: 'RFP Opportunity',
      description: 'desc',
      assigneeId: 'assignee-uuid',
    });

    const payload = mockCreateIssue.mock.calls[0][0];
    expect(payload.assigneeId).toBe('assignee-uuid');
  });

  it('omits labelIds when no labels resolve, rather than sending an empty array', async () => {
    await createLinearTicket({
      orgId: 'org-1',
      title: 'RFP Opportunity',
      description: 'desc',
      labels: ['RFP', 'Auto-Generated'],
    });

    const payload = mockCreateIssue.mock.calls[0][0];
    expect('labelIds' in payload).toBe(false);
  });

  it('returns null (and does not throw) when createIssue rejects', async () => {
    mockCreateIssue.mockRejectedValue(new Error('assigneeId must be a UUID'));

    const result = await createLinearTicket({
      orgId: 'org-1',
      title: 'RFP Opportunity',
      description: 'desc',
    });

    expect(result).toBeNull();
  });
});
