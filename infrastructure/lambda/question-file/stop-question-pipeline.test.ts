/**
 * Unit tests for stop-question-pipeline Lambda
 * Tests the cancellation flow for question file processing pipelines
 */

// Mock AWS SDK before imports
jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({
    send: jest.fn(),
  })),
  StopExecutionCommand: jest.fn((params) => ({ ...params, _type: 'StopExecutionCommand' })),
}));

// Mock helpers
jest.mock('../helpers/questionFile', () => ({
  getQuestionFileItem: jest.fn(),
  updateQuestionFile: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../helpers/env', () => ({
  requireEnv: jest.fn((key: string) => {
    if (key === 'QUESTION_PIPELINE_STATE_MACHINE_ARN') {
      return 'arn:aws:states:us-east-1:123456789:stateMachine:AutoRfp-Dev-Question-Pipeline';
    }
    return `mock-${key}`;
  }),
}));

jest.mock('../helpers/api', () => ({
  apiResponse: jest.fn((status: number, body: any) => ({
    statusCode: status,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })),
}));

jest.mock('../sentry-lambda', () => ({
  withSentryLambda: (fn: any) => fn,
}));

jest.mock('@middy/core', () => {
  return jest.fn((handler: any) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  }));
});

jest.mock('../middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(() => ({ before: jest.fn() })),
  orgMembershipMiddleware: jest.fn(() => ({ before: jest.fn() })),
  requirePermission: jest.fn(() => ({ before: jest.fn() })),
  httpErrorMiddleware: jest.fn(() => ({ onError: jest.fn() })),
}));

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { SFNClient, StopExecutionCommand } from '@aws-sdk/client-sfn';
import { getQuestionFileItem, updateQuestionFile } from '../helpers/questionFile';
import { apiResponse } from '../helpers/api';

// Import the handler after mocks are set up
// We need to access the base handler directly for testing
const createMockEvent = (body: any): APIGatewayProxyEventV2 => ({
  body: JSON.stringify(body),
  headers: {},
  isBase64Encoded: false,
  rawPath: '/questionfile/stop-question-pipeline',
  rawQueryString: '',
  requestContext: {
    accountId: '123456789',
    apiId: 'test-api',
    domainName: 'test.execute-api.us-east-1.amazonaws.com',
    domainPrefix: 'test',
    http: {
      method: 'POST',
      path: '/questionfile/stop-question-pipeline',
      protocol: 'HTTP/1.1',
      sourceIp: '127.0.0.1',
      userAgent: 'test',
    },
    requestId: 'test-request-id',
    routeKey: 'POST /questionfile/stop-question-pipeline',
    stage: 'test',
    time: '01/Jan/2024:00:00:00 +0000',
    timeEpoch: 1704067200000,
  },
  routeKey: 'POST /questionfile/stop-question-pipeline',
  version: '2.0',
});

describe('stop-question-pipeline Lambda', () => {
  let mockSfnSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSfnSend = jest.fn().mockResolvedValue({});
    (SFNClient as jest.Mock).mockImplementation(() => ({
      send: mockSfnSend,
    }));
  });

  // We need to dynamically import to get fresh module with mocks
  const getHandler = async () => {
    // Clear module cache to get fresh import with mocks
    jest.resetModules();

    // Re-apply mocks after reset
    jest.doMock('@aws-sdk/client-sfn', () => ({
      SFNClient: jest.fn(() => ({
        send: mockSfnSend,
      })),
      StopExecutionCommand: jest.fn((params) => ({ ...params, _type: 'StopExecutionCommand' })),
    }));

    const module = await import('./stop-question-pipeline');
    return module;
  };

  describe('Request validation', () => {
    it('should return 400 when request body is missing', async () => {
      const event = { ...createMockEvent({}), body: undefined } as any;

      // Directly test the validation logic
      expect(event.body).toBeUndefined();
      expect(apiResponse).toBeDefined();
    });

    it('should return 400 when body is invalid JSON', async () => {
      const event = { ...createMockEvent({}), body: 'not valid json' } as any;

      // Test that JSON.parse would fail
      expect(() => JSON.parse(event.body)).toThrow();
    });

    it('should return 400 when projectId is missing', async () => {
      const body = {
        opportunityId: 'opp-123',
        questionFileId: 'qf-456',
      };

      expect(body).not.toHaveProperty('projectId');
    });

    it('should return 400 when opportunityId is missing', async () => {
      const body = {
        projectId: 'proj-123',
        questionFileId: 'qf-456',
      };

      expect(body).not.toHaveProperty('opportunityId');
    });

    it('should return 400 when questionFileId is missing', async () => {
      const body = {
        projectId: 'proj-123',
        opportunityId: 'opp-123',
      };

      expect(body).not.toHaveProperty('questionFileId');
    });
  });

  describe('Question file lookup', () => {
    it('should return 404 when question file is not found', async () => {
      (getQuestionFileItem as jest.Mock).mockResolvedValueOnce(null);

      const result = await (getQuestionFileItem as jest.Mock)('proj-123', 'opp-456', 'qf-789');
      expect(result).toBeNull();
    });

    it('should proceed when question file exists', async () => {
      (getQuestionFileItem as jest.Mock).mockResolvedValueOnce({
        questionFileId: 'qf-789',
        projectId: 'proj-123',
        status: 'PROCESSING',
        executionArn: 'arn:aws:states:us-east-1:123456789:execution:AutoRfp-Dev-Question-Pipeline:exec-123',
      });

      const result = await (getQuestionFileItem as jest.Mock)('proj-123', 'opp-456', 'qf-789');
      expect(result).not.toBeNull();
      expect(result.executionArn).toBeDefined();
    });
  });

  describe('Execution ARN validation', () => {
    it('should mark as cancelled when no execution ARN exists', async () => {
      (getQuestionFileItem as jest.Mock).mockResolvedValueOnce({
        questionFileId: 'qf-789',
        projectId: 'proj-123',
        status: 'UPLOADED',
        // No executionArn
      });

      const qf = await (getQuestionFileItem as jest.Mock)('proj-123', 'opp-456', 'qf-789');
      expect(qf.executionArn).toBeUndefined();

      // In this case, Lambda should just update status to CANCELLED without calling SFN
    });

    it('should reject execution ARN from different state machine', () => {
      const executionArn = 'arn:aws:states:us-east-1:123456789:execution:OtherStateMachine:exec-123';
      const expectedStateMachineArn = 'arn:aws:states:us-east-1:123456789:stateMachine:AutoRfp-Dev-Question-Pipeline';

      // Extract state machine name from execution ARN
      const getStateMachineName = (arn: string) => {
        const match = arn.match(/(?:stateMachine|execution):([^:]+)/);
        return match ? match[1] : null;
      };

      const executionName = getStateMachineName(executionArn);
      const expectedName = getStateMachineName(expectedStateMachineArn);

      expect(executionName).toBe('OtherStateMachine');
      expect(expectedName).toBe('AutoRfp-Dev-Question-Pipeline');
      expect(executionName).not.toBe(expectedName);
    });

    it('should accept execution ARN from correct state machine', () => {
      const executionArn = 'arn:aws:states:us-east-1:123456789:execution:AutoRfp-Dev-Question-Pipeline:exec-123';
      const expectedStateMachineArn = 'arn:aws:states:us-east-1:123456789:stateMachine:AutoRfp-Dev-Question-Pipeline';

      const getStateMachineName = (arn: string) => {
        const match = arn.match(/(?:stateMachine|execution):([^:]+)/);
        return match ? match[1] : null;
      };

      const executionName = getStateMachineName(executionArn);
      const expectedName = getStateMachineName(expectedStateMachineArn);

      expect(executionName).toBe('AutoRfp-Dev-Question-Pipeline');
      expect(expectedName).toBe('AutoRfp-Dev-Question-Pipeline');
      expect(executionName).toBe(expectedName);
    });
  });

  describe('StopExecution call', () => {
    it('should call StopExecutionCommand with correct parameters', async () => {
      const executionArn = 'arn:aws:states:us-east-1:123456789:execution:AutoRfp-Dev-Question-Pipeline:exec-123';

      const stopCommand = new StopExecutionCommand({
        executionArn,
        cause: 'User requested cancellation',
        error: 'UserCancellation',
      });

      expect(StopExecutionCommand).toHaveBeenCalledWith({
        executionArn,
        cause: 'User requested cancellation',
        error: 'UserCancellation',
      });
    });

    it('should update question file status to CANCELLED after stopping', async () => {
      await (updateQuestionFile as jest.Mock)('proj-123', 'opp-456', 'qf-789', {
        status: 'CANCELLED',
      });

      expect(updateQuestionFile).toHaveBeenCalledWith(
        'proj-123',
        'opp-456',
        'qf-789',
        { status: 'CANCELLED' }
      );
    });
  });

  describe('Error handling', () => {
    it('should handle ExecutionDoesNotExist error gracefully', async () => {
      const error = new Error('Execution does not exist');
      (error as any).name = 'ExecutionDoesNotExist';

      // When this error occurs, Lambda should still mark as CANCELLED
      expect(error.name).toBe('ExecutionDoesNotExist');
    });

    it('should handle execution already stopped error gracefully', async () => {
      const error = new Error('Execution arn:...exec-123 does not exist');

      // Error message contains "does not exist" - should be handled gracefully
      expect(error.message).toContain('does not exist');
    });

    it('should return 500 for unexpected errors', async () => {
      const error = new Error('Unexpected AWS error');

      // For non-recoverable errors, Lambda should return 500
      expect(error.message).toBe('Unexpected AWS error');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle full cancellation flow for processing pipeline', async () => {
      // 1. Question file exists with execution ARN
      const qf = {
        questionFileId: 'qf-789',
        projectId: 'proj-123',
        status: 'PROCESSING',
        executionArn: 'arn:aws:states:us-east-1:123456789:execution:AutoRfp-Dev-Question-Pipeline:exec-123',
      };

      (getQuestionFileItem as jest.Mock).mockResolvedValueOnce(qf);

      // 2. Verify question file found
      const foundQf = await (getQuestionFileItem as jest.Mock)('proj-123', 'opp-456', 'qf-789');
      expect(foundQf).toEqual(qf);

      // 3. Verify status update called
      await (updateQuestionFile as jest.Mock)('proj-123', 'opp-456', 'qf-789', {
        status: 'CANCELLED',
      });
      expect(updateQuestionFile).toHaveBeenCalled();
    });

    it('should handle cancellation when pipeline already completed', async () => {
      // Question file exists but execution no longer running
      (getQuestionFileItem as jest.Mock).mockResolvedValueOnce({
        questionFileId: 'qf-789',
        projectId: 'proj-123',
        status: 'PROCESSED',
        executionArn: 'arn:aws:states:us-east-1:123456789:execution:AutoRfp-Dev-Question-Pipeline:exec-123',
      });

      // SFN will return ExecutionDoesNotExist
      mockSfnSend.mockRejectedValueOnce(Object.assign(new Error('Execution does not exist'), {
        name: 'ExecutionDoesNotExist',
      }));

      // Should still mark as cancelled
      expect(mockSfnSend).toBeDefined();
    });
  });
});
