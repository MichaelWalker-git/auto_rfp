const mockSfnSend = jest.fn().mockResolvedValue({
  executionArn: 'arn:aws:states:us-east-1:123:execution:test:exec-1',
  startDate: new Date('2024-01-01'),
});

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: mockSfnSend })),
  StartExecutionCommand: jest.fn((params) => ({ type: 'StartExecution', params })),
}));

process.env.QUESTION_PIPELINE_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:Test';

import { startPipeline } from './solicitation';

describe('startPipeline', () => {
  beforeEach(() => {
    mockSfnSend.mockClear();
  });

  it('includes orgId in the Step Function input JSON', async () => {
    await startPipeline('org-123', 'proj-1', 'opp-1', 'qf-1', 'uploads/rfp.pdf', 'application/pdf');

    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    const command = mockSfnSend.mock.calls[0][0];
    const input = JSON.parse(command.params.input);
    expect(input.orgId).toBe('org-123');
    expect(input.projectId).toBe('proj-1');
    expect(input.oppId).toBe('opp-1');
    expect(input.questionFileId).toBe('qf-1');
  });

  it('sends an empty string orgId (not undefined) when caller has no orgId', async () => {
    // SFN JsonPath references fail when a field is missing — pipeline must always include the key
    await startPipeline(undefined, 'proj-1', 'opp-1', 'qf-1');

    const command = mockSfnSend.mock.calls[0][0];
    const input = JSON.parse(command.params.input);
    expect(input).toHaveProperty('orgId');
    expect(input.orgId).toBe('');
  });
});
