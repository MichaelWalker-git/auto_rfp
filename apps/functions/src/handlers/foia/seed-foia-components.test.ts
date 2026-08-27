process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));

/**
 * The seeder reads its api.data.gov key from the secret store, which constructs a
 * real AWS client at module load. Unmocked, that fails under Jest with
 * "Right-hand side of 'instanceof' is not an object" from the Smithy HTTP
 * handler — a failure that looks nothing like the missing mock that causes it.
 *
 * Returning empty means these tests exercise the unauthenticated path, which is
 * what they were already asserting before the key moved into a secret.
 */
const mockReadPlainSecret = jest.fn().mockResolvedValue('');
jest.mock('@/helpers/secret', () => ({
  readPlainSecret: (...a: unknown[]) => mockReadPlainSecret(...a),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
}));

const mockUpsert = jest.fn();
jest.mock('@/helpers/foia-component', () => ({
  upsertFoiaComponent: (...a: unknown[]) => mockUpsert(...a),
}));

/**
 * Stubs the HTTPS layer with two pages of JSON:API payload, shaped exactly like
 * the live api.foia.gov response (verified against the real API).
 */
const pages: unknown[] = [];
jest.mock('https', () => ({
  get: (url: URL, _opts: unknown, cb: (res: unknown) => void) => {
    const offset = Number(new URL(url.toString()).searchParams.get('page[offset]') ?? '0');
    const body = JSON.stringify(pages[offset / 50] ?? { data: [] });
    const handlers: Record<string, (arg?: unknown) => void> = {};
    const res = {
      statusCode: 200,
      on: (evt: string, h: (arg?: unknown) => void) => {
        handlers[evt] = h;
        if (evt === 'end') {
          handlers['data']?.(Buffer.from(body));
          h();
        }
      },
    };
    cb(res);
    return { on: () => undefined, end: () => undefined };
  },
}));

import { baseHandler } from './seed-foia-components';

/** A real record shape, trimmed to the fields the seeder reads. */
const rawComponent = (over: Record<string, unknown> = {}) => ({
  id: (over.id as string) ?? 'uuid-army',
  attributes: {
    title: 'Department of the Army',
    abbreviation: 'DA',
    status: true,
    email: ['usarmy.belvoir.hqda-esa.mbx.rmda-foia@army.mil'],
    telephone: '703-428-6238',
    is_centralized: false,
    portal_submission_format: 'api',
    submission_fax: null,
    submission_web: { uri: 'https://www.foia.army.mil' },
    submission_address: {
      address_line1: '9301 Chapek Rd',
      locality: 'Fort Belvoir',
      administrative_area: 'VA',
      postal_code: '22060',
      country_code: 'US',
    },
    ...(over.attributes as Record<string, unknown> | undefined),
  },
  relationships: { agency: { data: { id: 'agency-dod' } } },
});

beforeEach(() => {
  jest.clearAllMocks();
  pages.length = 0;
  mockUpsert.mockResolvedValue({});
  delete process.env['FOIA_GOV_API_KEY'];
});

describe('seed-foia-components', () => {
  it('pages until the API returns an empty batch', async () => {
    pages.push({ data: [rawComponent({ id: 'a' })] });
    pages.push({ data: [rawComponent({ id: 'b' })] });

    const res = await baseHandler({});

    expect(res.fetched).toBe(2);
    expect(res.written).toBe(2);
  });

  it('maps the API payload onto the create DTO', async () => {
    pages.push({ data: [rawComponent()] });

    await baseHandler({});

    const [dto] = mockUpsert.mock.calls[0]! as [Record<string, unknown>];
    expect(dto).toMatchObject({
      componentId: 'uuid-army',
      title: 'Department of the Army',
      abbreviation: 'DA',
      agencyId: 'agency-dod',
      isActive: true,
      emails: ['usarmy.belvoir.hqda-esa.mbx.rmda-foia@army.mil'],
      submissionWebUrl: 'https://www.foia.army.mil',
      portalSubmissionFormat: 'api',
    });
    expect(dto.submissionAddress).toMatchObject({
      addressLine1: '9301 Chapek Rd',
      locality: 'Fort Belvoir',
      administrativeArea: 'VA',
      postalCode: '22060',
    });
  });

  it('marks an upstream-inactive component inactive', async () => {
    pages.push({ data: [rawComponent({ attributes: { status: false } })] });

    await baseHandler({});

    const [dto] = mockUpsert.mock.calls[0]! as [{ isActive: boolean }];
    expect(dto.isActive).toBe(false);
  });

  it('drops blank email entries', async () => {
    pages.push({ data: [rawComponent({ attributes: { email: ['  ', 'real@a.gov'] } })] });

    await baseHandler({});

    const [dto] = mockUpsert.mock.calls[0]! as [{ emails: string[] }];
    expect(dto.emails).toEqual(['real@a.gov']);
  });

  it('skips a record with no id or title rather than writing a broken row', async () => {
    pages.push({
      data: [
        { id: 'ok', attributes: { title: 'Real Agency', status: true, email: [] } },
        { attributes: { title: 'No id' } },
        { id: 'no-title', attributes: {} },
      ],
    });

    const res = await baseHandler({});

    expect(res.fetched).toBe(3);
    expect(res.written).toBe(1);
  });

  it('reports counts without writing on a dry run', async () => {
    pages.push({
      data: [
        rawComponent({ id: 'withEmail' }),
        rawComponent({ id: 'noEmail', attributes: { email: [] } }),
        rawComponent({ id: 'inactive', attributes: { status: false } }),
      ],
    });

    const res = await baseHandler({ detail: { dryRun: true } });

    expect(res.dryRun).toBe(true);
    expect(res.active).toBe(2);
    expect(res.emailable).toBe(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('keeps going when one write fails', async () => {
    pages.push({ data: [rawComponent({ id: 'bad' }), rawComponent({ id: 'good' })] });
    mockUpsert.mockImplementation((dto: { componentId: string }) => {
      if (dto.componentId === 'bad') throw new Error('throughput exceeded');
      return Promise.resolve({});
    });

    const res = await baseHandler({});

    // One bad row must not abandon the rest of the directory.
    expect(res.written).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.ok).toBe(true);
  });

  it('accumulates ambiguity counts across the pass', async () => {
    // Two components sharing a title, as "Office of Inspector General" does 12
    // times upstream. The shared map is what makes the pointer count correct.
    pages.push({
      data: [
        { id: 'oig1', attributes: { title: 'Office of Inspector General', abbreviation: 'OIG', status: true, email: [] } },
        { id: 'oig2', attributes: { title: 'Office of Inspector General', abbreviation: 'OIG', status: true, email: [] } },
      ],
    });

    const res = await baseHandler({});

    expect(res.ambiguousTitles).toBe(1);
    expect(res.ambiguousAbbrs).toBe(1);
    // Both calls share one `claimed` accumulator.
    const firstClaimed = mockUpsert.mock.calls[0]![1];
    const secondClaimed = mockUpsert.mock.calls[1]![1];
    expect(firstClaimed).toBe(secondClaimed);
  });

  it('works without an API key', async () => {
    pages.push({ data: [rawComponent()] });

    const res = await baseHandler({});

    expect(res.ok).toBe(true);
  });
});

describe('api key resolution', () => {
  /**
   * The key lives in a secret, not an env var. Before this, the seeder read
   * FOIA_GOV_API_KEY directly — and the first real run hit
   * `429 OVER_RATE_LIMIT` on the shared quota because nothing had set it,
   * leaving the component directory empty. An empty directory is what makes the
   * reconciler fall back to scraping recipients out of solicitation PDFs.
   */
  it('reads the key from the configured secret', async () => {
    process.env['FOIA_GOV_API_KEY_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:1:secret:k';
    mockReadPlainSecret.mockResolvedValueOnce('a-real-key');

    await baseHandler({ detail: { dryRun: true } } as never);

    expect(mockReadPlainSecret).toHaveBeenCalledWith(
      'arn:aws:secretsmanager:us-east-1:1:secret:k',
    );
    delete process.env['FOIA_GOV_API_KEY_SECRET_ARN'];
  });

  it('still runs when the secret cannot be read', async () => {
    // Degrading to the shared quota is worse but not broken; throwing would turn
    // a credential problem into a total outage of the directory refresh.
    process.env['FOIA_GOV_API_KEY_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:1:secret:k';
    mockReadPlainSecret.mockRejectedValueOnce(new Error('AccessDenied'));

    await expect(baseHandler({ detail: { dryRun: true } } as never)).resolves.toBeDefined();

    delete process.env['FOIA_GOV_API_KEY_SECRET_ARN'];
  });
});
