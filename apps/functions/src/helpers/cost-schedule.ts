/**
 * cost-schedule.ts
 *
 * Deterministic math + prompt-block rendering for the Solution Plan's
 * structured cost schedule (plan-governed cost consistency).
 *
 * The synthesis worker recomputes the schedule totals with
 * `computeCostScheduleTotals` before persisting — model-stated totals are
 * never trusted (LLM sums are unreliable; that was the original incident).
 * `renderCostScheduleBlock` produces the fixed-format "AUTHORITATIVE COST
 * SCHEDULE" text block injected into pricing-document prompts.
 *
 * Pure functions, no I/O.
 */

import type {
  SolutionPlanCostBilling,
  SolutionPlanCostItem,
  SolutionPlanCostSchedule,
} from '@auto-rfp/core';

import { formatMoney, roundCents } from './pricing-table-math';

const BILLING_LABELS: Record<SolutionPlanCostBilling, string> = {
  ONE_TIME: 'one-time',
  MONTHLY: 'monthly',
  ANNUAL: 'annual',
};

/**
 * Recompute the schedule totals from its items:
 *   oneTimeTotal       = Σ non-null ONE_TIME amounts
 *   ongoingAnnualTotal = Σ non-null ANNUAL amounts + 12 × Σ non-null MONTHLY amounts
 * Null amounts (vendor quote required) and optional items (option CLINs,
 * if-exercised scope — priced separately, never part of the base/evaluated
 * price) are excluded. Rounded to cents.
 */
export const computeCostScheduleTotals = (
  items: SolutionPlanCostItem[],
): { oneTimeTotal: number; ongoingAnnualTotal: number } => {
  let oneTime = 0;
  let annual = 0;
  let monthly = 0;

  for (const item of items) {
    if (item.amount === null || item.optional) continue;
    if (item.billing === 'ONE_TIME') oneTime += item.amount;
    else if (item.billing === 'ANNUAL') annual += item.amount;
    else monthly += item.amount;
  }

  return {
    oneTimeTotal: roundCents(oneTime),
    ongoingAnnualTotal: roundCents(annual + 12 * monthly),
  };
};

/**
 * Render the schedule as the deterministic fixed-format prompt block. One line
 * per item (`label | category | billing | amount` — billing is kept even for
 * unpriced items so the prompt knows the cadence of a vendor-quote line), the
 * two authoritative TOTAL lines, and the (a)/(b)/(c) usage rule that pins
 * every dollar figure in the generated document to the schedule.
 */
export const renderCostScheduleBlock = (schedule: SolutionPlanCostSchedule): string => {
  const renderItem = (item: SolutionPlanCostItem): string => {
    const amount = item.amount === null ? 'vendor quote required' : formatMoney(item.amount, true);
    const description = item.description ? ` — ${item.description}` : '';
    return `- ${item.label} | ${item.category} | ${BILLING_LABELS[item.billing]} | ${amount}${description}`;
  };

  const baseItems = schedule.items.filter((item) => !item.optional);
  const optionalItems = schedule.items.filter((item) => item.optional);

  const optionalLines = optionalItems.length
    ? [
        '',
        'OPTIONAL ITEMS (NOT included in the totals — price separately if the RFP requests options):',
        ...optionalItems.map(renderItem),
      ]
    : [];

  const assumptionLines = schedule.assumptions?.length
    ? ['', 'ASSUMPTIONS:', ...schedule.assumptions.map((a) => `- ${a}`)]
    : [];

  const optionalRule = optionalItems.length
    ? [
        '- Optional items are NOT in the TOTAL lines. Never add them to the base/evaluated totals; present them as separately-priced options only when the RFP asks.',
      ]
    : [];

  return [
    '═══════════════════════════════════════',
    'AUTHORITATIVE COST SCHEDULE (SOURCE OF TRUTH — COPY THESE NUMBERS EXACTLY)',
    '═══════════════════════════════════════',
    `Currency: ${schedule.currency}`,
    '',
    ...baseItems.map(renderItem),
    '',
    `TOTAL ONE-TIME: ${formatMoney(schedule.oneTimeTotal, true)}`,
    `TOTAL ONGOING (ANNUAL): ${formatMoney(schedule.ongoingAnnualTotal, true)}`,
    ...optionalLines,
    ...assumptionLines,
    '',
    'USAGE RULES:',
    '- Every dollar figure in your document MUST be one of: (a) an item amount from this schedule copied verbatim, (b) a sum of item amounts from this schedule, or (c) an exact ×12/÷12 monthly↔annual conversion of an item amount or sum.',
    '- Your document\'s one-time total and ongoing-annual total MUST equal the TOTAL lines above EXACTLY.',
    '- Items marked "vendor quote required" appear without a price — never fill the gap with an invented number.',
    ...optionalRule,
  ].join('\n');
};
