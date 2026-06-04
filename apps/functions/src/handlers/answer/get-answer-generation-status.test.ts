// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock Step Functions — use var so it is hoisted along with jest.mock
// eslint-disable-next-line no-var
var mockSfnSend = jest.fn();
jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: mockSfnSend })),
  ListExecutionsCommand: jest.fn((params) => ({ type: 'ListExecutions', params })),
}));

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const STATE_MACHINE_ARN =
  'arn:aws:states:us-east-1:123456789:stateMachine:AutoRfp-test-AnswerGen-Pipeline';

type BaseHandler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

// The handler captures ANSWER_GENERATION_STATE_MACHINE_ARN at module load, so
// load it fresh after setting/clearing the env var to exercise both paths.
const loadHandler = (arn: string | undefined): BaseHandler => {
  let handler!: BaseHandler;
  if (arn === undefined) {
    delete process.env.ANSWER_GENERATION_STATE_MACHINE_ARN;
  } else {
    process.env.ANSWER_GENERATION_STATE_MACHINE_ARN = arn;
  }
  jest.isolateModules(() => {
    handler = require('./get-answer-generation-status').baseHandler;
  });
  return handler;
};

const makeEvent = (opts: { projectId?: string; opportunityId?: string }): APIGatewayProxyEventV2 =>
  ({
    pathParameters: opts.projectId ? { id: opts.projectId } : {},
    queryStringParameters: {
      orgId: 'org-1',
      ...(opts.opportunityId ? { opportunityId: opts.opportunityId } : {}),
    },
  }) as unknown as APIGatewayProxyEventV2;

const parseBody = (response: APIGatewayProxyResultV2) =>
  JSON.parse((response as { body: string }).body);

describe('get-answer-generation-status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSfnSend.mockReset();
  });

  it('returns isGenerating=true with executionArn when a run exists for the opportunity', async () => {
    const baseHandler = loadHandler(STATE_MACHINE_ARN);
    const executionArn = `${STATE_MACHINE_ARN.replace('stateMachine', 'execution')}:beaf6c34-1700000000000`;
    mockSfnSend.mockResolvedValueOnce({
      executions: [
        { name: 'other-opp-1699999999999', executionArn: 'arn:other' },
        { name: 'beaf6c34-1700000000000', executionArn },
      ],
    });

    const response = await baseHandler(makeEvent({ projectId: 'proj-1', opportunityId: 'beaf6c34' }));

    expect(response).toMatchObject({ statusCode: 200 });
    expect(parseBody(response)).toEqual({ isGenerating: true, executionArn });
  });

  it('returns isGenerating=false when the only running execution is for a different opportunity', async () => {
    const baseHandler = loadHandler(STATE_MACHINE_ARN);
    mockSfnSend.mockResolvedValueOnce({
      executions: [{ name: 'some-other-opp-1700000000000', executionArn: 'arn:other' }],
    });

    const response = await baseHandler(makeEvent({ projectId: 'proj-1', opportunityId: 'beaf6c34' }));

    expect(response).toMatchObject({ statusCode: 200 });
    expect(parseBody(response)).toEqual({ isGenerating: false });
  });

  it('returns isGenerating=false when there are no running executions', async () => {
    const baseHandler = loadHandler(STATE_MACHINE_ARN);
    mockSfnSend.mockResolvedValueOnce({ executions: [] });

    const response = await baseHandler(makeEvent({ projectId: 'proj-1', opportunityId: 'beaf6c34' }));

    expect(response).toMatchObject({ statusCode: 200 });
    expect(parseBody(response)).toEqual({ isGenerating: false });
  });

  it('returns isGenerating=false without calling SFN when the ARN env var is unset', async () => {
    const baseHandler = loadHandler(undefined);

    const response = await baseHandler(makeEvent({ projectId: 'proj-1', opportunityId: 'beaf6c34' }));

    expect(response).toMatchObject({ statusCode: 200 });
    expect(parseBody(response)).toEqual({ isGenerating: false });
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it('returns isGenerating=false (best-effort, never 500) when SFN throws', async () => {
    const baseHandler = loadHandler(STATE_MACHINE_ARN);
    mockSfnSend.mockRejectedValueOnce(new Error('SFN unavailable'));

    const response = await baseHandler(makeEvent({ projectId: 'proj-1', opportunityId: 'beaf6c34' }));

    expect(response).toMatchObject({ statusCode: 200 });
    expect(parseBody(response)).toEqual({ isGenerating: false });
  });

  it('returns 400 when projectId is missing', async () => {
    const baseHandler = loadHandler(STATE_MACHINE_ARN);

    const response = await baseHandler(makeEvent({ opportunityId: 'beaf6c34' }));

    expect(response).toMatchObject({ statusCode: 400 });
    expect(parseBody(response).message).toBe('Missing projectId');
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it('returns 400 when opportunityId is missing', async () => {
    const baseHandler = loadHandler(STATE_MACHINE_ARN);

    const response = await baseHandler(makeEvent({ projectId: 'proj-1' }));

    expect(response).toMatchObject({ statusCode: 400 });
    expect(parseBody(response).message).toBe('Missing opportunityId');
    expect(mockSfnSend).not.toHaveBeenCalled();
  });
});
