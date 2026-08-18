/**
 * plan-cost-reconciliation.ts
 *
 * Deterministic doc↔plan totals reconciliation (plan-governed cost
 * consistency). After the Fix B pricing-math pass, this pass forces the
 * document's one-time / ongoing-annual / monthly TOTAL rows to the Solution
 * Plan cost schedule's authoritative values, so both pricing documents always
 * carry the plan's totals no matter what the LLM composed.
 *
 * Enforcement is auto-correct + warn (product decision, 2026-08-17) — the
 * caller logs corrections/warnings and never fails the job.
 *
 * A row is touched only when ALL guards hold:
 *  - its first cell matches TOTAL_LABEL_RE
 *  - it has exactly ONE money cell after the label cell (Year 1 | Year 2 |
 *    Year 3 layouts have no safely-identifiable "annual" column — skipped +
 *    warned; money inside the label cell is a formula annotation, not a value)
 *  - its label is not year-qualified ("Year 1 Total", "3-Year Total")
 *  - its label matches exactly one bucket (one-time AND ongoing → skip + warn)
 *
 * GRAND-labeled rows with no data rows since the previous total are recomputed
 * from the effective (post-force) prior totals instead of the schedule.
 *
 * Pure string/regex table walking on the same primitives as
 * pricing-table-math.ts. Pure function, no I/O.
 */

import type { SolutionPlanCostSchedule } from '@auto-rfp/core';

import {
  formatMoney,
  GRAND_LABEL_RE,
  parseCells,
  roundCents,
  ROW_RE,
  stripTags,
  TABLE_RE,
  TOLERANCE,
  TOTAL_LABEL_RE,
} from './pricing-table-math';

export type ReconciliationBucket = 'ONE_TIME' | 'ONGOING_ANNUAL' | 'ONGOING_MONTHLY' | 'GRAND';

export interface PlanTotalCorrection {
  tableIndex: number;
  rowLabel: string;
  bucket: ReconciliationBucket;
  previousValue: string; // e.g. "$4,440.00"
  correctedValue: string; // e.g. "$4,800.00"
}

export interface PlanReconciliationResult {
  html: string;
  corrections: PlanTotalCorrection[];
  warnings: string[];
}

// Bucket regexes (§2 of the implementation doc).
const MONTHLY_TOTAL_RE = /\bmonthly\b|\bper\s+month\b|\bMRC\b/i;
const ONE_TIME_TOTAL_RE = /\bone[-\s]?time\b|\bnon[-\s]?recurring\b|\bNRC\b/i;
const ONGOING_ANNUAL_TOTAL_RE = /\bongoing\b|\brecurring\b|\bannual(?:ized)?\b|\bper\s+year\b|\byearly\b|\bARC\b/i;

// "Year 1 Total", "3-Year Total", "Years 1-3" — a year-scoped figure must NOT
// be forced to the plan's plain annual total.
const YEAR_QUALIFIED_RE = /\byears?\s*\d|\d+\s*(?:[-–—]\s*\d+\s*)?[-\s]?years?\b/i;

/**
 * Classify a total-row label into a schedule bucket. One-time phrases are
 * stripped before the ongoing test so "non-recurring" (which contains the
 * word "recurring") reads as ONE_TIME, not as ambiguous.
 */
const classifyLabel = (
  label: string,
): Exclude<ReconciliationBucket, 'GRAND'> | 'AMBIGUOUS' | null => {
  const isOneTime = ONE_TIME_TOTAL_RE.test(label);
  const withoutOneTime = label.replace(new RegExp(ONE_TIME_TOTAL_RE.source, 'gi'), ' ');
  const isMonthly = MONTHLY_TOTAL_RE.test(withoutOneTime);
  const isOngoingAnnual = ONGOING_ANNUAL_TOTAL_RE.test(withoutOneTime);

  if (isOneTime && (isMonthly || isOngoingAnnual)) return 'AMBIGUOUS';
  if (isMonthly) return 'ONGOING_MONTHLY';
  if (isOneTime) return 'ONE_TIME';
  if (isOngoingAnnual) return 'ONGOING_ANNUAL';
  return null;
};

interface TableWalkState {
  corrections: PlanTotalCorrection[];
  warnings: string[];
  /** Bucket/grand rows seen anywhere in the document (zero → observability warning). */
  candidateCount: number;
}

const processTable = (
  tableHtml: string,
  tableIndex: number,
  schedule: SolutionPlanCostSchedule,
  state: TableWalkState,
): string => {
  const rowReplacements: Array<{ start: number; end: number; html: string }> = [];

  /** Effective (post-force) values of prior single-money-cell total rows. */
  const priorTotals: Array<{ value: number; hasCents: boolean }> = [];
  let hasDataSinceLastTotal = false;

  for (const rowMatch of tableHtml.matchAll(ROW_RE)) {
    const rowHtml = rowMatch[0];
    const cells = parseCells(rowHtml);
    if (cells.length === 0) continue;

    const label = stripTags(cells[0]!.inner);
    if (!TOTAL_LABEL_RE.test(label)) {
      if (cells.some((c) => c.money)) hasDataSinceLastTotal = true;
      continue;
    }

    // Money in the label cell is a formula annotation ("12 × $370/mo"), not a
    // value — only the cells after the label count toward the one-value guard.
    const moneyCells = cells.slice(1).filter((c) => c.money);
    const bucket = classifyLabel(label);
    const isGrand = GRAND_LABEL_RE.test(label);
    const hadDataBefore = hasDataSinceLastTotal;
    hasDataSinceLastTotal = false;

    if (YEAR_QUALIFIED_RE.test(label)) {
      if (bucket || isGrand) {
        state.warnings.push(
          `table ${tableIndex} row "${label}": year-qualified total skipped (a year-scoped figure must not equal the plan's plain totals)`,
        );
      }
      continue;
    }

    if (moneyCells.length !== 1) {
      if (moneyCells.length > 1 && (bucket || isGrand)) {
        state.warnings.push(
          `table ${tableIndex} row "${label}": ${moneyCells.length} money cells (multi-year column layout?) — skipped, cannot identify the annual column`,
        );
      }
      continue;
    }

    const cell = moneyCells[0]!;
    const money = cell.money!;

    if (bucket === 'AMBIGUOUS') {
      state.warnings.push(
        `table ${tableIndex} row "${label}": label matches both one-time and ongoing buckets — skipped`,
      );
      priorTotals.push({ value: money.value, hasCents: money.hasCents });
      continue;
    }

    let target: number | null = null;
    let appliedBucket: ReconciliationBucket | null = null;

    if (bucket === 'ONE_TIME') {
      target = schedule.oneTimeTotal;
      appliedBucket = 'ONE_TIME';
    } else if (bucket === 'ONGOING_ANNUAL') {
      target = schedule.ongoingAnnualTotal;
      appliedBucket = 'ONGOING_ANNUAL';
    } else if (bucket === 'ONGOING_MONTHLY') {
      target = roundCents(schedule.ongoingAnnualTotal / 12);
      appliedBucket = 'ONGOING_MONTHLY';
    } else if (isGrand && !hadDataBefore && priorTotals.length > 0) {
      // Grand total directly after total rows: recompute from the effective
      // (post-force) prior totals rather than the schedule.
      target = roundCents(priorTotals.reduce((sum, prior) => sum + prior.value, 0));
      appliedBucket = 'GRAND';
    }

    let effectiveValue = money.value;
    let effectiveHasCents = money.hasCents;

    if (target !== null && appliedBucket !== null) {
      state.candidateCount += 1;

      if (Math.abs(money.value - target) > TOLERANCE) {
        const withCents = money.hasCents || !Number.isInteger(target);
        const corrected = formatMoney(target, withCents);
        const inner =
          cell.inner.slice(0, money.innerIndex) +
          corrected +
          cell.inner.slice(money.innerIndex + money.text.length);
        const rebuiltRow =
          rowHtml.slice(0, cell.start) +
          `${cell.openTag}${inner}${cell.closeTag}` +
          rowHtml.slice(cell.end);
        rowReplacements.push({
          start: rowMatch.index!,
          end: rowMatch.index! + rowHtml.length,
          html: rebuiltRow,
        });
        state.corrections.push({
          tableIndex,
          rowLabel: label,
          bucket: appliedBucket,
          previousValue: money.text,
          correctedValue: corrected,
        });
        // Fix B ran first, so the stated value already equals the sum of the
        // row's line items — the residual delta after forcing measures genuine
        // line-item divergence from the plan, not an LLM arithmetic slip.
        state.warnings.push(
          `table ${tableIndex} row "${label}": line items diverge from the plan after forcing ` +
          `(docTotal=${formatMoney(money.value, true)}, planTotal=${formatMoney(target, true)}, delta=${formatMoney(roundCents(Math.abs(money.value - target)), true)})`,
        );
        effectiveValue = target;
        effectiveHasCents = withCents;
      }
    }

    priorTotals.push({ value: effectiveValue, hasCents: effectiveHasCents });
  }

  if (rowReplacements.length === 0) return tableHtml;

  let rebuilt = '';
  let cursor = 0;
  for (const rep of rowReplacements) {
    rebuilt += tableHtml.slice(cursor, rep.start) + rep.html;
    cursor = rep.end;
  }
  rebuilt += tableHtml.slice(cursor);
  return rebuilt;
};

/**
 * Force the document's one-time / ongoing-annual / monthly total rows to the
 * plan cost schedule's values (monthly = annual ÷ 12), recompute grand totals
 * from the effective prior totals, and report every correction and every
 * skipped-row/zero-candidate condition as a warning. Corrections fire only
 * when |stated − target| > $1.00 (same TOLERANCE as Fix B). Malformed or
 * table-less HTML passes through unchanged.
 */
export const reconcileTotalsWithPlan = (
  html: string,
  schedule: SolutionPlanCostSchedule,
): PlanReconciliationResult => {
  if (!html || !/<table\b/i.test(html)) {
    return {
      html,
      corrections: [],
      warnings: ['document has no tables — nothing to reconcile with the plan cost schedule'],
    };
  }

  const state: TableWalkState = { corrections: [], warnings: [], candidateCount: 0 };
  let result = '';
  let cursor = 0;
  let tableIndex = 0;

  for (const tableMatch of html.matchAll(TABLE_RE)) {
    result += html.slice(cursor, tableMatch.index);
    result += processTable(tableMatch[0], tableIndex, schedule, state);
    cursor = tableMatch.index! + tableMatch[0].length;
    tableIndex += 1;
  }
  result += html.slice(cursor);

  if (state.candidateCount === 0) {
    state.warnings.push(
      'no reconcilable total rows found — the document totals were not checked against the plan cost schedule',
    );
  }

  return { html: result, corrections: state.corrections, warnings: state.warnings };
};

/**
 * Call-site wrapper shared by the generation worker and the section-edit
 * handler: run the reconciliation in a try/catch (auto-correct + warn — it
 * must never fail the job), WARN-log every correction and warning, and return
 * the possibly-corrected HTML (the input HTML on any failure).
 */
export const applyPlanReconciliationSafe = (args: {
  html: string;
  schedule: SolutionPlanCostSchedule;
  /** Log prefix of the call site, e.g. '[worker]' or '[edit-section]'. */
  logPrefix: string;
  documentId: string;
}): string => {
  const { html, schedule, logPrefix, documentId } = args;
  try {
    const reconciled = reconcileTotalsWithPlan(html, schedule);
    if (reconciled.corrections.length > 0) {
      console.warn(
        `${logPrefix} Plan reconciliation forced ${reconciled.corrections.length} total(s) to the cost schedule for documentId=${documentId}: ` +
        reconciled.corrections
          .map((c) => `"${c.rowLabel}": ${c.previousValue} → ${c.correctedValue} (plan)`)
          .join('; '),
      );
    }
    for (const warning of reconciled.warnings) {
      console.warn(`${logPrefix} Plan reconciliation warning for documentId=${documentId}: ${warning}`);
    }
    return reconciled.corrections.length > 0 ? reconciled.html : html;
  } catch (err) {
    console.warn(
      `${logPrefix} Plan reconciliation failed (non-blocking) for documentId=${documentId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return html;
  }
};
