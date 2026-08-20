/**
 * Tests for the cost-schedule helper: deterministic totals math and the
 * fixed-format AUTHORITATIVE COST SCHEDULE prompt block.
 */
import type { SolutionPlanCostItem, SolutionPlanCostSchedule } from '@auto-rfp/core';

import { computeCostScheduleTotals, renderCostScheduleBlock } from './cost-schedule';

const item = (overrides: Partial<SolutionPlanCostItem>): SolutionPlanCostItem => ({
  label: 'Item',
  category: 'OTHER',
  amount: 0,
  billing: 'ONE_TIME',
  optional: false,
  ...overrides,
});

describe('computeCostScheduleTotals', () => {
  it('sums ONE_TIME amounts into oneTimeTotal', () => {
    const totals = computeCostScheduleTotals([
      item({ amount: 1000, billing: 'ONE_TIME' }),
      item({ amount: 2500.5, billing: 'ONE_TIME' }),
    ]);
    expect(totals).toEqual({ oneTimeTotal: 3500.5, ongoingAnnualTotal: 0 });
  });

  it('annualizes MONTHLY amounts (×12) and adds ANNUAL amounts', () => {
    const totals = computeCostScheduleTotals([
      item({ amount: 400, billing: 'MONTHLY' }), // 4,800/yr
      item({ amount: 1200, billing: 'ANNUAL' }),
    ]);
    expect(totals).toEqual({ oneTimeTotal: 0, ongoingAnnualTotal: 6000 });
  });

  it('excludes null amounts (vendor quote required) from every total', () => {
    const totals = computeCostScheduleTotals([
      item({ amount: 1000, billing: 'ONE_TIME' }),
      item({ amount: null, billing: 'ONE_TIME' }),
      item({ amount: null, billing: 'MONTHLY' }),
    ]);
    expect(totals).toEqual({ oneTimeTotal: 1000, ongoingAnnualTotal: 0 });
  });

  it('rounds to cents (floating-point accumulation)', () => {
    const totals = computeCostScheduleTotals([
      item({ amount: 0.1, billing: 'MONTHLY' }),
      item({ amount: 0.2, billing: 'MONTHLY' }),
    ]);
    expect(totals.ongoingAnnualTotal).toBe(3.6);
  });

  it('returns zero totals for an all-unpriced schedule', () => {
    expect(computeCostScheduleTotals([item({ amount: null })])).toEqual({
      oneTimeTotal: 0,
      ongoingAnnualTotal: 0,
    });
  });

  it('excludes optional items from both totals (2026-08-18 incident fixture)', () => {
    // Base annual $2,402,050 + optional ANNUAL $129,600 must total $2,402,050,
    // not $2,531,650 — optional CLINs are priced separately.
    const totals = computeCostScheduleTotals([
      item({ label: 'Steady-state operations', amount: 2402050, billing: 'ANNUAL' }),
      item({
        label: 'Real-Time Eligibility Integration Upgrade (Optional)',
        amount: 129600,
        billing: 'ANNUAL',
        optional: true,
      }),
      item({ label: 'Optional setup', amount: 5000, billing: 'ONE_TIME', optional: true }),
      item({ label: 'Optional add-on', amount: 100, billing: 'MONTHLY', optional: true }),
    ]);
    expect(totals).toEqual({ oneTimeTotal: 0, ongoingAnnualTotal: 2402050 });
  });
});

describe('renderCostScheduleBlock', () => {
  const schedule: SolutionPlanCostSchedule = {
    currency: 'USD',
    items: [
      item({ label: 'Managed hosting', category: 'LABOR', amount: 400, billing: 'MONTHLY' }),
      item({ label: 'Implementation', category: 'LABOR', amount: 34720, billing: 'ONE_TIME', description: 'Fixed-price build' }),
      item({ label: 'GIS plugin', category: 'THIRD_PARTY', amount: null, billing: 'ANNUAL' }),
    ],
    oneTimeTotal: 34720,
    ongoingAnnualTotal: 4800,
    assumptions: ['12-month period of performance'],
  };

  it('renders the header, one line per item (label | category | billing | amount), and the authoritative totals', () => {
    const block = renderCostScheduleBlock(schedule);
    expect(block).toContain('AUTHORITATIVE COST SCHEDULE (SOURCE OF TRUTH — COPY THESE NUMBERS EXACTLY)');
    expect(block).toContain('- Managed hosting | LABOR | monthly | $400.00');
    expect(block).toContain('- Implementation | LABOR | one-time | $34,720.00 — Fixed-price build');
    expect(block).toContain('TOTAL ONE-TIME: $34,720.00');
    expect(block).toContain('TOTAL ONGOING (ANNUAL): $4,800.00');
  });

  it('renders unpriced items as "vendor quote required", keeping the billing period, with no dollar figure', () => {
    const block = renderCostScheduleBlock(schedule);
    expect(block).toContain('- GIS plugin | THIRD_PARTY | annual | vendor quote required');
    expect(block).not.toMatch(/GIS plugin[^\n]*\$/);
  });

  it('states the (a)/(b)/(c) usage rule and the exact-total requirement', () => {
    const block = renderCostScheduleBlock(schedule);
    expect(block).toContain('(a) an item amount from this schedule copied verbatim');
    expect(block).toContain('(b) a sum of item amounts');
    expect(block).toContain('(c) an exact ×12/÷12 monthly↔annual conversion');
    expect(block).toContain('MUST equal the TOTAL lines above EXACTLY');
  });

  it('includes assumptions when present and omits the section when absent', () => {
    expect(renderCostScheduleBlock(schedule)).toContain('ASSUMPTIONS:\n- 12-month period of performance');
    const { assumptions: _omitted, ...noAssumptions } = schedule;
    expect(renderCostScheduleBlock(noAssumptions)).not.toContain('ASSUMPTIONS:');
  });

  it('is deterministic — same schedule, same block', () => {
    expect(renderCostScheduleBlock(schedule)).toBe(renderCostScheduleBlock(schedule));
  });

  it('renders optional items in a separate section after the TOTAL lines, with the optional usage rule', () => {
    const withOptional: SolutionPlanCostSchedule = {
      ...schedule,
      items: [
        ...schedule.items,
        item({
          label: 'Real-Time Eligibility Integration Upgrade (Optional)',
          category: 'THIRD_PARTY',
          amount: 129600,
          billing: 'ANNUAL',
          optional: true,
        }),
      ],
    };
    const block = renderCostScheduleBlock(withOptional);
    expect(block).toContain(
      'OPTIONAL ITEMS (NOT included in the totals — price separately if the RFP requests options):',
    );
    expect(block).toContain(
      '- Real-Time Eligibility Integration Upgrade (Optional) | THIRD_PARTY | annual | $129,600.00',
    );
    expect(block).toContain('Optional items are NOT in the TOTAL lines.');
    // The optional section comes after the authoritative TOTAL lines.
    expect(block.indexOf('TOTAL ONGOING (ANNUAL):')).toBeLessThan(block.indexOf('OPTIONAL ITEMS'));
  });

  it('omits the optional section and rule when there are no optional items', () => {
    const block = renderCostScheduleBlock(schedule);
    expect(block).not.toContain('OPTIONAL ITEMS');
    expect(block).not.toContain('Optional items are NOT in the TOTAL lines.');
  });
});
