/**
 * Tests for the deterministic pricing-table totals validator (Fix B).
 * Fixtures mirror the pricing-consistency incident: bundled/wrong totals
 * ("Plugin Licenses $866" over rows summing to $867.80) and mismatched
 * ongoing-fee totals ($5,235 stated vs $5,245 computed).
 */
import { correctPricingTableTotals } from './pricing-table-math';

const table = (rows: string[]): string =>
  `<table style="width:100%"><tbody>${rows.join('')}</tbody></table>`;

const row = (cells: string[], tag: 'td' | 'th' = 'td'): string =>
  `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;

describe('correctPricingTableTotals', () => {
  it('leaves a correct total untouched', () => {
    const html = table([
      row(['Service', 'Price'], 'th'),
      row(['Datadog Pro', '$100.00']),
      row(['GitHub Enterprise', '$250.00']),
      row(['Total', '$350.00']),
    ]);
    const { html: out, corrections } = correctPricingTableTotals(html);
    expect(out).toBe(html);
    expect(corrections).toEqual([]);
  });

  it('rewrites a wrong total with the computed column sum (incident fixture)', () => {
    // The incident's "$866" bundled-row table: component prices sum to $867.80
    const html = table([
      row(['Plugin', 'Monthly Price'], 'th'),
      row(['Plugin A', '$399.00']),
      row(['Plugin B', '$249.90']),
      row(['Plugin C', '$218.90']),
      row(['Total Plugin Licenses', '$866']),
    ]);
    const { html: out, corrections } = correctPricingTableTotals(html);
    expect(out).toContain('$867.80');
    expect(out).not.toContain('$866<');
    expect(corrections).toEqual([
      {
        tableIndex: 0,
        rowLabel: 'Total Plugin Licenses',
        previousValue: '$866',
        correctedValue: '$867.80',
      },
    ]);
  });

  it('does not correct when the mismatch is within the $1.00 tolerance', () => {
    const html = table([
      row(['Item A', '$100.50']),
      row(['Item B', '$200.00']),
      row(['Total', '$300.00']), // off by $0.50 — rounding, not an error
    ]);
    const { corrections } = correctPricingTableTotals(html);
    expect(corrections).toEqual([]);
  });

  it('corrects a mismatch just over the tolerance', () => {
    const html = table([
      row(['Item A', '$100.00']),
      row(['Item B', '$200.00']),
      row(['Total', '$301.50']),
    ]);
    const { html: out, corrections } = correctPricingTableTotals(html);
    expect(corrections).toHaveLength(1);
    expect(out).toContain('$300.00');
  });

  it('uses the LAST money match in a cell — formula labels are not the value', () => {
    // "2 hrs/mo × 12 × $105/hr" — the formula's $105 must not be read as the value
    const html = table([
      row(['Support (2 hrs/mo × 12 × $105/hr)', '$2,280']),
      row(['Hosting', '$1,000']),
      row(['Total Ongoing', '$3,000']),
    ]);
    const { html: out, corrections } = correctPricingTableTotals(html);
    // Sum uses 2,280 + 1,000 = 3,280 — not 105 + 1,000
    expect(corrections).toHaveLength(1);
    expect(out).toContain('$3,280');
    // The formula label itself is untouched
    expect(out).toContain('× $105/hr');
  });

  it('handles subtotal + grand-total tables: the grand total sums the subtotals', () => {
    const html = table([
      row(['One-Time Item A', '$1,000.00']),
      row(['One-Time Item B', '$2,000.00']),
      row(['Subtotal One-Time', '$3,000.00']),
      row(['Ongoing Item C', '$500.00']),
      row(['Ongoing Item D', '$700.00']),
      row(['Subtotal Ongoing', '$1,100.00']), // wrong: should be $1,200
      row(['Grand Total', '$4,100.00']), // consistent with the wrong subtotal
    ]);
    const { html: out, corrections } = correctPricingTableTotals(html);
    // The second subtotal is corrected to $1,200, and the grand total is
    // recomputed over the corrected subtotals: 3,000 + 1,200 = 4,200.
    expect(corrections).toHaveLength(2);
    expect(out).toContain('$1,200.00');
    expect(out).toContain('$4,200.00');
  });

  it('aligns money columns from the end of the row, so colspan total labels line up', () => {
    const html = table([
      row(['Service', 'Tier', 'Qty', 'Extended'], 'th'),
      row(['Datadog', 'Pro', '2', '$46.00']),
      row(['GitHub', 'Enterprise', '5', '$105.00']),
      `<tr><td colspan="3">Total</td><td>$200.00</td></tr>`,
    ]);
    const { html: out, corrections } = correctPricingTableTotals(html);
    expect(corrections).toHaveLength(1);
    expect(out).toContain('$151.00');
  });

  it('corrects each money column of a total row independently', () => {
    const html = table([
      row(['Service', 'Unit Price', 'Extended'], 'th'),
      row(['A', '$10.00', '$120.00']),
      row(['B', '$20.00', '$240.00']),
      row(['Total', '$25.00', '$360.00']), // unit-price total wrong, extended correct
    ]);
    const { html: out, corrections } = correctPricingTableTotals(html);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]!.previousValue).toBe('$25.00');
    expect(out).toContain('$30.00');
    expect(out).toContain('$360.00');
  });

  it('keeps whole-dollar formatting when no source row carries cents', () => {
    const html = table([
      row(['Item A', '$1,000']),
      row(['Item B', '$2,500']),
      row(['Total', '$4,000']),
    ]);
    const { html: out, corrections } = correctPricingTableTotals(html);
    expect(corrections).toHaveLength(1);
    expect(out).toContain('$3,500');
    expect(out).not.toContain('$3,500.00');
  });

  it('skips tables without total rows', () => {
    const html = table([
      row(['Item A', '$100.00']),
      row(['Item B', '$200.00']),
    ]);
    const { html: out, corrections } = correctPricingTableTotals(html);
    expect(out).toBe(html);
    expect(corrections).toEqual([]);
  });

  it('skips non-money tables (e.g. compliance matrices)', () => {
    const html = table([
      row(['Requirement', 'Compliance'], 'th'),
      row(['Section L.1', 'YES']),
      row(['Total compliance items: 12', 'YES']),
    ]);
    const { html: out, corrections } = correctPricingTableTotals(html);
    expect(out).toBe(html);
    expect(corrections).toEqual([]);
  });

  it('skips a total row whose column has no data money cells above it', () => {
    const html = table([
      row(['Description'], 'th'),
      row(['Narrative row without prices']),
      row(['Total', '$500.00']),
    ]);
    const { html: out, corrections } = correctPricingTableTotals(html);
    expect(out).toBe(html);
    expect(corrections).toEqual([]);
  });

  it('passes malformed HTML through unchanged', () => {
    const unclosedTable = '<table><tr><td>Item</td><td>$100</td>'; // never closed
    expect(correctPricingTableTotals(unclosedTable)).toEqual({
      html: unclosedTable,
      corrections: [],
    });
    expect(correctPricingTableTotals('')).toEqual({ html: '', corrections: [] });
    expect(correctPricingTableTotals('<p>No tables here — $12 total</p>')).toEqual({
      html: '<p>No tables here — $12 total</p>',
      corrections: [],
    });
  });

  it('processes multiple tables independently and reports tableIndex', () => {
    const html =
      '<h2>One-Time</h2>' +
      table([row(['Setup', '$1,000.00']), row(['Total', '$1,000.00'])]) +
      '<h2>Ongoing</h2>' +
      table([
        row(['Hosting', '$4,000.00']),
        row(['Support', '$1,245.00']),
        row(['Total Ongoing Fees', '$5,235.00']), // incident: stated ≠ 5,245
      ]);
    const { html: out, corrections } = correctPricingTableTotals(html);
    expect(corrections).toEqual([
      {
        tableIndex: 1,
        rowLabel: 'Total Ongoing Fees',
        previousValue: '$5,235.00',
        correctedValue: '$5,245.00',
      },
    ]);
    expect(out).toContain('$5,245.00');
    expect(out).toContain('$1,000.00'); // first table untouched
  });

  it('leaves an ambiguous grand total (subtotals AND loose data rows above) untouched', () => {
    const html = table([
      row(['Item A', '$1,000.00']),
      row(['Subtotal', '$1,000.00']),
      row(['Item B', '$500.00']),
      row(['Grand Total', '$1,500.00']),
    ]);
    const { html: out } = correctPricingTableTotals(html);
    // $1,500 is right (subtotal + item B), but the shape is ambiguous — the
    // validator must not "correct" it to $500 (data-since-last-total only).
    expect(out).toContain('$1,500.00');
  });

  it('preserves surrounding cell markup when rewriting a total', () => {
    const html = table([
      row(['Item A', '$100.00']),
      row(['Item B', '$200.00']),
      `<tr><td><strong>Total</strong></td><td><strong>$400.00</strong></td></tr>`,
    ]);
    const { html: out } = correctPricingTableTotals(html);
    expect(out).toContain('<strong>$300.00</strong>');
  });
});
