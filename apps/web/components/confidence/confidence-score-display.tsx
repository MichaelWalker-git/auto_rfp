'use client';

import type { ConfidenceBreakdown, ConfidenceBand } from '@auto-rfp/core';
import { Progress } from '@/components/ui/progress';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize confidence to 0-1 range, handling both 0-1 and 0-100 inputs */
export function normalizeConfidence(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value > 1) return Math.min(value / 100, 1);
  return Math.max(0, value);
}

function resolveBand(confidence: number, band?: ConfidenceBand): ConfidenceBand {
  if (band) return band;
  const pct = Math.round(normalizeConfidence(confidence) * 100);
  if (pct >= 90) return 'high';
  if (pct >= 70) return 'medium';
  return 'low';
}

// ─── Band styling ─────────────────────────────────────────────────────────────

const BAND_LABEL: Record<ConfidenceBand, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const BAND_BADGE_CLASS: Record<ConfidenceBand, string> = {
  high:   'bg-emerald-50 text-emerald-700 border border-emerald-200',
  medium: 'bg-amber-50   text-amber-700   border border-amber-200',
  low:    'bg-red-50     text-red-700     border border-red-200',
};

const BAND_BAR_CLASS: Record<ConfidenceBand, string> = {
  high:   '[&>div]:bg-emerald-500',
  medium: '[&>div]:bg-amber-500',
  low:    '[&>div]:bg-red-500',
};

// ─── Factor config ────────────────────────────────────────────────────────────

const FACTORS: { key: keyof ConfidenceBreakdown; label: string; weight: string }[] = [
  { key: 'contextRelevance', label: 'Context Relevance', weight: '40%' },
  { key: 'sourceRecency',    label: 'Source Recency',    weight: '25%' },
  { key: 'answerCoverage',   label: 'Answer Coverage',   weight: '20%' },
  { key: 'sourceAuthority',  label: 'Source Authority',  weight: '10%' },
  { key: 'consistency',      label: 'Consistency',       weight: '5%'  },
];

function factorColor(value: number): string {
  if (value >= 80) return 'text-emerald-600';
  if (value >= 60) return 'text-amber-600';
  return 'text-red-600';
}

function factorBarClass(value: number): string {
  if (value >= 80) return '[&>div]:bg-emerald-500';
  if (value >= 60) return '[&>div]:bg-amber-500';
  return '[&>div]:bg-red-500';
}

// ─── Compact badge (used in navigator, lists, etc.) ───────────────────────────

interface ConfidenceBadgeProps {
  confidence?: number;
  band?: ConfidenceBand;
}

export function ConfidenceBadge({ confidence, band }: ConfidenceBadgeProps) {
  if (confidence === undefined || confidence === null) return null;
  const norm = normalizeConfidence(confidence);
  const pct = Math.round(norm * 100);
  const resolvedBand = resolveBand(norm, band);
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${BAND_BADGE_CLASS[resolvedBand]}`}>
      {pct}%
    </span>
  );
}

// ─── Full display ─────────────────────────────────────────────────────────────

interface ConfidenceScoreDisplayProps {
  confidence?: number;
  breakdown?: ConfidenceBreakdown;
  band?: ConfidenceBand;
  /** @deprecated kept for API compatibility — no longer used */
  compact?: boolean;
  /** @deprecated kept for API compatibility — breakdown is always shown */
  defaultOpen?: boolean;
}

export function ConfidenceScoreDisplay({
  confidence,
  breakdown,
}: ConfidenceScoreDisplayProps) {
  if (confidence === undefined || confidence === null) return null;

  return (
    <div className="space-y-2">
      {/* Factor breakdown only — overall score is shown in the collapse header */}
      {breakdown && FACTORS.map(({ key, label, weight }) => {
        const value = breakdown[key];
        return (
          <div key={key} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">
                {label}
                <span className="ml-1 text-slate-400 text-[10px]">({weight})</span>
              </span>
              <span className={`font-medium tabular-nums ${factorColor(value)}`}>
                {value}%
              </span>
            </div>
            <Progress
              value={value}
              className={`h-1 ${factorBarClass(value)}`}
            />
          </div>
        );
      })}
    </div>
  );
}

export default ConfidenceScoreDisplay;
