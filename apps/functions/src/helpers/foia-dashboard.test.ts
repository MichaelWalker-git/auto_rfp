const mockListFoiaAutomationsByOrg = jest.fn();
const mockListFoiaRequestsByOrg = jest.fn();
// The aggregation queries the OPPORTUNITY partition directly with a projection rather
// than going through listOpportunitiesByOrg — that helper adds a USER-partition query
// for names this dashboard never reads, and an unprojected read pulled 1.6MB of
// document text per call.
const mockQueryAllBySkPrefix = jest.fn();

jest.mock('@/helpers/foia-automation', () => ({
  listFoiaAutomationsByOrg: (...a: unknown[]) => mockListFoiaAutomationsByOrg(...a),
}));

jest.mock('@/helpers/foia', () => ({
  listFoiaRequestsByOrg: (...a: unknown[]) => mockListFoiaRequestsByOrg(...a),
}));

jest.mock('@/helpers/db', () => ({
  queryAllBySkPrefix: (...a: unknown[]) => mockQueryAllBySkPrefix(...a),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { buildFoiaDashboard } from './foia-dashboard';

const ORG = 'org-1';

/** A LOST opportunity with both bid amounts — the chartable shape. */
const lostOpp = (over: Record<string, unknown> = {}) => ({
  oppId: 'opp-lost',
  projectId: 'proj-1',
  orgId: ORG,
  title: 'Student Prospect Digital Profile Solution',
  organizationName: 'Texas Tech University Health Sciences Center',
  solicitationNumber: 'RFP 739-SL3722874',
  status: 'LOST',
  outcomeDate: '2026-01-29T00:00:00.000Z',
  lossData: {
    lossDate: '2026-01-29T00:00:00.000Z',
    lossReason: 'PRICE_TOO_HIGH',
    ourBidAmount: 250_000,
    winningBidAmount: 198_500,
    winningContractor: 'Acme Systems',
  },
  ...over,
});

const automation = (over: Record<string, unknown> = {}) => ({
  orgId: ORG,
  projectId: 'proj-1',
  oppId: 'opp-lost',
  state: 'SENT',
  ...over,
});

const prime = (args?: {
  automations?: unknown[];
  requests?: unknown[];
  opportunities?: unknown[];
}) => {
  mockListFoiaAutomationsByOrg.mockResolvedValue(args?.automations ?? []);
  mockListFoiaRequestsByOrg.mockResolvedValue(args?.requests ?? []);
  mockQueryAllBySkPrefix.mockResolvedValue(args?.opportunities ?? []);
};

describe('buildFoiaDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    [
      mockListFoiaAutomationsByOrg,
      mockListFoiaRequestsByOrg,
      mockQueryAllBySkPrefix,
    ].forEach((m) => m.mockReset());
  });

  it('reads all three sets scoped to the org', async () => {
    prime();

    await buildFoiaDashboard(ORG);

    expect(mockListFoiaAutomationsByOrg).toHaveBeenCalledWith(ORG);
    expect(mockListFoiaRequestsByOrg).toHaveBeenCalledWith(ORG);
    // Projected, and scoped by the org prefix on the single-table sort key.
    expect(mockQueryAllBySkPrefix).toHaveBeenCalledWith(
      'OPPORTUNITY',
      `${ORG}#`,
      expect.stringContaining('lossData'),
      expect.objectContaining({ '#status': 'status' }),
    );
  });

  it('returns zeroed counts for an org with nothing tracked', async () => {
    // An empty org must render an empty state, not fail.
    prime();

    const result = await buildFoiaDashboard(ORG);

    expect(result.counts).toEqual({ WON: 0, LOST: 0, NOT_PRESENT: 0, CANCELLED: 0 });
    expect(result.pricing).toEqual([]);
    expect(result.pricingCoverage).toEqual({ withPricing: 0, total: 0 });
    expect(result.documentCount).toBe(0);
  });

  describe('bucketing', () => {
    it('counts a loss and a win', async () => {
      prime({
        opportunities: [
          lostOpp(),
          lostOpp({ oppId: 'opp-won', status: 'WON', lossData: undefined }),
        ],
      });

      const { counts } = await buildFoiaDashboard(ORG);

      expect(counts.LOST).toBe(1);
      expect(counts.WON).toBe(1);
    });

    it('counts a suppressed automation as CANCELLED, not LOST', async () => {
      // The opportunity is still LOST on its own record — the outcome field is never
      // cleared — so a status-first implementation would miscount this.
      prime({
        automations: [automation({ state: 'SUPPRESSED' })],
        opportunities: [lostOpp()],
      });

      const { counts } = await buildFoiaDashboard(ORG);

      expect(counts.CANCELLED).toBe(1);
      expect(counts.LOST).toBe(0);
    });

    it('counts a no-records reply as NOT_PRESENT, not LOST', async () => {
      prime({
        automations: [automation({ responseOutcome: 'NO_RECORDS_LOCATED' })],
        opportunities: [lostOpp()],
      });

      const { counts } = await buildFoiaDashboard(ORG);

      expect(counts.NOT_PRESENT).toBe(1);
      expect(counts.LOST).toBe(0);
    });

    it('excludes opportunities with no terminal outcome', async () => {
      // Counting these would inflate every denominator on the page.
      prime({
        opportunities: [
          lostOpp({ oppId: 'opp-open', status: 'IN_PROGRESS', lossData: undefined }),
          lostOpp({ oppId: 'opp-sub', status: 'SUBMITTED', lossData: undefined }),
        ],
      });

      const { counts, pricingCoverage } = await buildFoiaDashboard(ORG);

      expect(counts).toEqual({ WON: 0, LOST: 0, NOT_PRESENT: 0, CANCELLED: 0 });
      expect(pricingCoverage.total).toBe(0);
    });

    it('skips an opportunity missing its identifiers', async () => {
      prime({ opportunities: [lostOpp({ oppId: undefined }), lostOpp({ projectId: undefined })] });

      const { counts } = await buildFoiaDashboard(ORG);

      expect(counts.LOST).toBe(0);
    });
  });

  describe('orphans', () => {
    it('ignores an automation whose opportunity no longer exists', async () => {
      // A deleted opportunity leaves its automation row behind. That must not crash,
      // and must not invent a bucket for a thing with no outcome to report.
      prime({
        automations: [automation({ oppId: 'opp-deleted', state: 'SENT' })],
        opportunities: [],
      });

      const result = await buildFoiaDashboard(ORG);

      expect(result.counts).toEqual({ WON: 0, LOST: 0, NOT_PRESENT: 0, CANCELLED: 0 });
    });

    it('includes an opportunity that has no automation record', async () => {
      // A loss recorded before FOIA automation existed still belongs on the dashboard.
      prime({ automations: [], opportunities: [lostOpp()] });

      const { counts, pricing } = await buildFoiaDashboard(ORG);

      expect(counts.LOST).toBe(1);
      expect(pricing).toHaveLength(1);
    });

    it('tolerates an automation with no oppId', async () => {
      prime({ automations: [automation({ oppId: undefined })], opportunities: [lostOpp()] });

      const { counts } = await buildFoiaDashboard(ORG);

      expect(counts.LOST).toBe(1);
    });
  });

  describe('pricing', () => {
    it('projects a chartable row', async () => {
      prime({ opportunities: [lostOpp()] });

      const { pricing } = await buildFoiaDashboard(ORG);

      expect(pricing[0]).toMatchObject({
        oppId: 'opp-lost',
        ourBidAmount: 250_000,
        winningBidAmount: 198_500,
        winningContractor: 'Acme Systems',
        agencyName: 'Texas Tech University Health Sciences Center',
        hasPricing: true,
      });
    });

    it('excludes a row with only one amount from the chart but counts it in coverage', async () => {
      // This is the "name the gaps" contract: the reader must be able to tell
      // "we only have one" from "we have one of three".
      prime({
        opportunities: [
          lostOpp(),
          lostOpp({
            oppId: 'opp-half',
            lossData: { lossDate: '2026-02-01T00:00:00.000Z', lossReason: 'TECHNICAL_SCORE', ourBidAmount: 100 },
          }),
          lostOpp({
            oppId: 'opp-none',
            lossData: { lossDate: '2026-02-02T00:00:00.000Z', lossReason: 'TECHNICAL_SCORE' },
          }),
        ],
      });

      const { pricing, pricingCoverage } = await buildFoiaDashboard(ORG);

      expect(pricing).toHaveLength(1);
      expect(pricingCoverage).toEqual({ withPricing: 1, total: 3 });
    });

    it('excludes wins — we are the awardee, so there is nothing to compare', async () => {
      prime({
        opportunities: [
          lostOpp({
            oppId: 'opp-won',
            status: 'WON',
            lossData: undefined,
            winData: { contractValue: 300_000, awardDate: '2026-03-01T00:00:00.000Z' },
          }),
        ],
      });

      const { pricing, pricingCoverage } = await buildFoiaDashboard(ORG);

      expect(pricing).toEqual([]);
      expect(pricingCoverage.total).toBe(0);
    });

    it('caps the chart at five and keeps the most recent', async () => {
      const rows = Array.from({ length: 8 }, (_, i) =>
        lostOpp({
          oppId: `opp-${i}`,
          lossData: {
            lossDate: `2026-0${i + 1}-01T00:00:00.000Z`,
            lossReason: 'PRICE_TOO_HIGH',
            ourBidAmount: 100 + i,
            winningBidAmount: 90 + i,
          },
        }),
      );
      prime({ opportunities: rows });

      const { pricing, pricingCoverage } = await buildFoiaDashboard(ORG);

      expect(pricing).toHaveLength(5);
      // Newest first: 2026-08 down to 2026-04.
      expect(pricing[0]!.oppId).toBe('opp-7');
      expect(pricing[4]!.oppId).toBe('opp-3');
      // Coverage stays uncapped so the UI can say "5 of 8".
      expect(pricingCoverage).toEqual({ withPricing: 8, total: 8 });
    });

    it('orders rows with no date last rather than dropping them', async () => {
      prime({
        opportunities: [
          lostOpp({
            oppId: 'opp-undated',
            outcomeDate: undefined,
            lossData: { lossReason: 'PRICE_TOO_HIGH', ourBidAmount: 1, winningBidAmount: 2 },
          }),
          lostOpp(),
        ],
      });

      const { pricing } = await buildFoiaDashboard(ORG);

      expect(pricing).toHaveLength(2);
      expect(pricing[1]!.oppId).toBe('opp-undated');
    });
  });

  describe('scores', () => {
    it('includes recorded evaluation scores', async () => {
      prime({
        opportunities: [
          lostOpp({
            lossData: {
              lossDate: '2026-01-29T00:00:00.000Z',
              lossReason: 'TECHNICAL_SCORE',
              evaluationScores: { technical: 72, price: 88, overall: 78 },
            },
          }),
        ],
      });

      const { scores } = await buildFoiaDashboard(ORG);

      expect(scores).toHaveLength(1);
      expect(scores[0]!.ourScores).toEqual({ technical: 72, price: 88, overall: 78 });
      // The winner's scores are not stored yet, so the UI must not imply a comparison.
      expect(scores[0]!.winnerScores).toBeUndefined();
    });

    it('passes the winner scores through', async () => {
      prime({
        opportunities: [
          lostOpp({
            lossData: {
              lossDate: '2026-01-29T00:00:00.000Z',
              lossReason: 'TECHNICAL_SCORE',
              evaluationScores: { technical: 61 },
              winnerScores: { technical: 92 },
            },
          }),
        ],
      });

      const { scores } = await buildFoiaDashboard(ORG);

      expect(scores[0]!.ourScores).toEqual({ technical: 61 });
      expect(scores[0]!.winnerScores).toEqual({ technical: 92 });
    });

    it('includes a row scored only for the winner', async () => {
      // A comparative tabulation can disclose the awardee's score with no debrief for
      // us. Guarding on our own scores alone would drop the row entirely.
      prime({
        opportunities: [
          lostOpp({
            lossData: {
              lossDate: '2026-01-29T00:00:00.000Z',
              lossReason: 'TECHNICAL_SCORE',
              winnerScores: { price: 95 },
            },
          }),
        ],
      });

      const { scores } = await buildFoiaDashboard(ORG);

      expect(scores).toHaveLength(1);
      expect(scores[0]!.ourScores).toEqual({});
      expect(scores[0]!.winnerScores).toEqual({ price: 95 });
    });

    it('omits winnerScores when none are stored', async () => {
      prime({
        opportunities: [
          lostOpp({
            lossData: {
              lossDate: '2026-01-29T00:00:00.000Z',
              lossReason: 'TECHNICAL_SCORE',
              evaluationScores: { technical: 61 },
            },
          }),
        ],
      });

      const { scores } = await buildFoiaDashboard(ORG);

      expect(scores[0]!.winnerScores).toBeUndefined();
    });

    it('omits opportunities with no scores recorded', async () => {
      prime({ opportunities: [lostOpp()] });

      const { scores } = await buildFoiaDashboard(ORG);

      expect(scores).toEqual([]);
    });
  });

  describe('documents and sends', () => {
    it('totals response documents across every request', async () => {
      prime({
        requests: [
          { foiaId: 'f1', responseDocuments: [{ s3Key: 'a' }, { s3Key: 'b' }] },
          { foiaId: 'f2', responseDocuments: [{ s3Key: 'c' }] },
          { foiaId: 'f3' },
        ],
      });

      const { documentCount } = await buildFoiaDashboard(ORG);

      expect(documentCount).toBe(3);
    });

    it('counts only transmitted requests as sent', async () => {
      prime({
        requests: [
          { foiaId: 'f1', sentAt: '2026-08-01T00:00:00.000Z' },
          { foiaId: 'f2' },
        ],
      });

      const { sentCount } = await buildFoiaDashboard(ORG);

      expect(sentCount).toBe(1);
    });

    it('breaks down what agencies actually replied', async () => {
      prime({
        automations: [
          automation({ oppId: 'o1', responseOutcome: 'RECORDS_RECEIVED' }),
          automation({ oppId: 'o2', responseOutcome: 'RECORDS_RECEIVED' }),
          automation({ oppId: 'o3', responseOutcome: 'DENIED' }),
        ],
        opportunities: [
          lostOpp({ oppId: 'o1' }),
          lostOpp({ oppId: 'o2' }),
          lostOpp({ oppId: 'o3' }),
        ],
      });

      const { responseOutcomeCounts } = await buildFoiaDashboard(ORG);

      expect(responseOutcomeCounts).toEqual({ RECORDS_RECEIVED: 2, DENIED: 1 });
    });
  });

  it('stamps calculatedAt', async () => {
    prime();

    const { calculatedAt } = await buildFoiaDashboard(ORG);

    expect(calculatedAt).toEqual(expect.any(String));
  });

  it('propagates a read failure rather than reporting partial totals', async () => {
    // A dashboard that silently renders partial numbers is worse than one that
    // errors: a reader cannot tell an empty bucket from a failed query.
    prime();
    mockQueryAllBySkPrefix.mockRejectedValue(new Error('table unavailable'));

    await expect(buildFoiaDashboard(ORG)).rejects.toThrow('table unavailable');
  });
});
