/**
 * Tests for the plan↔document totals reconciliation pass. Fixtures mirror the
 * 2026-08-17 incident: COST_PROPOSAL and PRICE_VOLUME reporting different
 * totals ($4,800/yr vs $4,440/yr ongoing; $34,720 vs $38,880 one-time) for
 * the same opportunity.
 */
import type { SolutionPlanCostSchedule } from '@auto-rfp/core';

import { reconcileTotalsWithPlan } from './plan-cost-reconciliation';

const schedule: SolutionPlanCostSchedule = {
  currency: 'USD',
  items: [
    { label: 'Implementation', category: 'LABOR', amount: 34720, billing: 'ONE_TIME' },
    { label: 'Managed hosting', category: 'LABOR', amount: 400, billing: 'MONTHLY' },
  ],
  oneTimeTotal: 34720,
  ongoingAnnualTotal: 4800,
};

const table = (rows: string[]): string =>
  `<table style="width:100%"><tbody>${rows.join('')}</tbody></table>`;

const row = (cells: string[], tag: 'td' | 'th' = 'td'): string =>
  `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;

describe('reconcileTotalsWithPlan', () => {
  it('forces a one-time total to the schedule value (incident fixture)', () => {
    const html = table([
      row(['Item', 'Price'], 'th'),
      row(['Implementation', '$38,880.00']),
      row(['Total One-Time Costs', '$38,880.00']),
    ]);
    const { html: out, corrections } = reconcileTotalsWithPlan(html, schedule);
    expect(out).toContain('$34,720.00');
    expect(corrections).toEqual([
      {
        tableIndex: 0,
        rowLabel: 'Total One-Time Costs',
        bucket: 'ONE_TIME',
        previousValue: '$38,880.00',
        correctedValue: '$34,720.00',
      },
    ]);
  });

  it('forces an ongoing-annual total to the schedule value (incident fixture)', () => {
    const html = table([
      row(['Hosting', '$4,440.00']),
      row(['Total Ongoing Annual Fees', '$4,440.00']),
    ]);
    const { corrections } = reconcileTotalsWithPlan(html, schedule);
    expect(corrections).toEqual([
      expect.objectContaining({
        bucket: 'ONGOING_ANNUAL',
        previousValue: '$4,440.00',
        correctedValue: '$4,800.00',
      }),
    ]);
  });

  it('forces a monthly total to the schedule annual ÷ 12', () => {
    const html = table([
      row(['Hosting', '$370.00']),
      row(['Total Monthly Recurring Charges', '$370.00']),
    ]);
    const { html: out, corrections } = reconcileTotalsWithPlan(html, schedule);
    expect(corrections).toEqual([
      expect.objectContaining({ bucket: 'ONGOING_MONTHLY', correctedValue: '$400.00' }),
    ]);
    expect(out).toContain('$400.00');
  });

  it('classifies "Non-Recurring" as one-time, not as ambiguous-with-recurring', () => {
    const html = table([
      row(['Setup', '$1,000.00']),
      row(['Total Non-Recurring Costs (NRC)', '$1,000.00']),
    ]);
    const { corrections, warnings } = reconcileTotalsWithPlan(html, schedule);
    expect(corrections).toEqual([
      expect.objectContaining({ bucket: 'ONE_TIME', correctedValue: '$34,720.00' }),
    ]);
    // The only warning is the residual line-item divergence of the forced row
    expect(warnings).toEqual([expect.stringContaining('diverge from the plan')]);
  });

  it('WARN-logs the residual line-item delta (docTotal/planTotal/delta) when a total is forced', () => {
    const html = table([
      row(['Hosting', '$4,440.00']),
      row(['Total Ongoing Annual Fees', '$4,440.00']),
    ]);
    const { warnings } = reconcileTotalsWithPlan(html, schedule);
    expect(warnings).toEqual([
      expect.stringContaining('docTotal=$4,440.00, planTotal=$4,800.00, delta=$360.00'),
    ]);
  });

  it('leaves a total within the $1.00 tolerance untouched', () => {
    const html = table([row(['Total One-Time Costs', '$34,720.50'])]);
    const { html: out, corrections } = reconcileTotalsWithPlan(html, schedule);
    expect(out).toBe(html);
    expect(corrections).toEqual([]);
  });

  it('skips multi-money-cell total rows (Year 1 | Year 2 | Year 3 layouts) with a warning', () => {
    const html = table([
      row(['CLIN', 'Year 1', 'Year 2', 'Year 3'], 'th'),
      row(['Hosting', '$4,800.00', '$4,944.00', '$5,092.00']),
      row(['Total Ongoing Costs', '$4,800.00', '$4,944.00', '$5,092.00']),
    ]);
    const { html: out, corrections, warnings } = reconcileTotalsWithPlan(html, schedule);
    expect(out).toBe(html);
    expect(corrections).toEqual([]);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('3 money cells')]),
    );
  });

  it('skips year-qualified total labels with a warning', () => {
    const html = table([
      row(['Hosting', '$14,400.00']),
      row(['3-Year Total Ongoing Costs', '$14,400.00']),
      row(['Year 1 Annual Total', '$4,800.00']),
    ]);
    const { html: out, corrections, warnings } = reconcileTotalsWithPlan(html, schedule);
    expect(out).toBe(html);
    expect(corrections).toEqual([]);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"3-Year Total Ongoing Costs": year-qualified'),
        expect.stringContaining('"Year 1 Annual Total": year-qualified'),
      ]),
    );
  });

  it('skips a label matching both one-time and ongoing buckets with a warning', () => {
    const html = table([
      row(['Total One-Time and Annual Costs', '$39,520.00']),
    ]);
    const { html: out, corrections, warnings } = reconcileTotalsWithPlan(html, schedule);
    expect(out).toBe(html);
    expect(corrections).toEqual([]);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('both one-time and ongoing')]),
    );
  });

  it('recomputes a grand total from the effective (post-force) prior totals', () => {
    const html = table([
      row(['Implementation', '$38,880.00']),
      row(['Total One-Time Costs', '$38,880.00']), // forced → $34,720
      row(['Hosting', '$4,440.00']),
      row(['Total Ongoing Annual Costs', '$4,440.00']), // forced → $4,800
      row(['Grand Total', '$43,320.00']), // stale: must become 34,720 + 4,800
    ]);
    const { html: out, corrections } = reconcileTotalsWithPlan(html, schedule);
    expect(corrections).toHaveLength(3);
    expect(corrections[2]).toEqual(
      expect.objectContaining({ bucket: 'GRAND', correctedValue: '$39,520.00' }),
    );
    expect(out).toContain('$39,520.00');
  });

  it('leaves a grand total with loose data rows above it untouched (ambiguous shape)', () => {
    const html = table([
      row(['Total One-Time Costs', '$34,720.00']),
      row(['Contingency', '$1,000.00']),
      row(['Grand Total', '$35,720.00']),
    ]);
    const { corrections } = reconcileTotalsWithPlan(html, schedule);
    expect(corrections).toEqual([]);
  });

  it('warns when the document has no reconcilable total rows', () => {
    const html = table([
      row(['Item A', '$100.00']),
      row(['Subtotal Labor', '$100.00']), // total-labeled, but no bucket
    ]);
    const { html: out, corrections, warnings } = reconcileTotalsWithPlan(html, schedule);
    expect(out).toBe(html);
    expect(corrections).toEqual([]);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('no reconcilable total rows')]),
    );
  });

  it('warns (and passes through) when the HTML has no tables', () => {
    const { html: out, warnings } = reconcileTotalsWithPlan('<p>Narrative only</p>', schedule);
    expect(out).toBe('<p>Narrative only</p>');
    expect(warnings).toEqual([expect.stringContaining('no tables')]);
  });

  it('processes multiple tables independently and reports tableIndex', () => {
    const html =
      table([row(['Total One-Time Costs', '$38,880.00'])]) +
      table([row(['Total Ongoing Annual Fees', '$4,440.00'])]);
    const { corrections } = reconcileTotalsWithPlan(html, schedule);
    expect(corrections).toEqual([
      expect.objectContaining({ tableIndex: 0, bucket: 'ONE_TIME' }),
      expect.objectContaining({ tableIndex: 1, bucket: 'ONGOING_ANNUAL' }),
    ]);
  });

  it('preserves surrounding cell markup and formula labels when forcing a total', () => {
    const html = table([
      `<tr><td><strong>Total Ongoing (12 × $370/mo)</strong></td><td><strong>$4,440.00</strong></td></tr>`,
    ]);
    const { html: out } = reconcileTotalsWithPlan(html, schedule);
    expect(out).toContain('<strong>$4,800.00</strong>');
    expect(out).toContain('12 × $370/mo'); // the label formula is untouched
  });
});
