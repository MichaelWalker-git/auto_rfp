'use client';

import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ConfidenceBreakdown, ConfidenceBand } from '@auto-rfp/core';

// ─── Types ───

interface ConfidenceScoreDisplayProps {
  /** Overall confidence 0-1 */
  confidence?: number;
  /** Detailed breakdown */
  breakdown?: ConfidenceBreakdown;
  /** Confidence band */
  band?: ConfidenceBand;
  /** Show compact badge only */
  compact?: boolean;
}

// ─── Constants ───

const FACTOR_LABELS: Record<keyof ConfidenceBreakdown, string> = {
  contextRelevance: 'Context Relevance',
  sourceRecency: 'Source Recency',
  answerCoverage: 'Answer Coverage',
  sourceAuthority: 'Source Authority',
  consistency: 'Consistency',
};

const FACTOR_WEIGHTS: Record<keyof ConfidenceBreakdown, string> = {
  contextRelevance: '40%',
  sourceRecency: '25%',
  answerCoverage: '20%',
  sourceAuthority: '10%',
  consistency: '5%',
};

const BAND_CONFIG: Record<ConfidenceBand, { label: string; variant: 'default' | 'secondary' | 'destructive'; color: string; badgeClass: string }> = {
  high: { label: 'High', variant: 'default', color: 'text-green-600', badgeClass: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100' },
  medium: { label: 'Medium', variant: 'secondary', color: 'text-yellow-600', badgeClass: 'bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100' },
  low: { label: 'Low', variant: 'destructive', color: 'text-red-600', badgeClass: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100' },
};

// ─── Helpers ───

/** Normalize confidence to 0-1 range, handling both 0-1 and 0-100 inputs */
export function normalizeConfidence(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value > 1) return Math.min(value / 100, 1); // Already in 0-100 range
  return Math.max(0, value); // Already in 0-1 range
}

function getBand(confidence: number): ConfidenceBand {
  const norm = normalizeConfidence(confidence);
  const pct = Math.round(norm * 100);
  if (pct >= 90) return 'high';
  if (pct >= 70) return 'medium';
  return 'low';
}

function getFactorStatus(value: number): string {
  if (value >= 80) return '✓';
  if (value >= 60) return '⚠️';
  return '✗';
}

function getFactorColor(value: number): string {
  if (value >= 80) return 'text-green-600';
  if (value >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

// ─── Components ───

/** Compact confidence badge */
export function ConfidenceBadge({ confidence, band }: { confidence?: number; band?: ConfidenceBand }) {
  if (confidence === undefined || confidence === null) return null;

  const norm = normalizeConfidence(confidence);
  const pct = Math.round(norm * 100);
  const resolvedBand = band || getBand(norm);
  const config = BAND_CONFIG[resolvedBand];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={`text-xs cursor-help ${config.badgeClass}`}>
            {pct}%
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{config.label} confidence — {pct}%</p>
          {resolvedBand === 'high' && <p className="text-xs text-muted-foreground">Minimal review needed</p>}
          {resolvedBand === 'medium' && <p className="text-xs text-muted-foreground">Verify facts before using</p>}
          {resolvedBand === 'low' && <p className="text-xs text-muted-foreground">Requires careful review</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Full confidence score display with breakdown */
export function ConfidenceScoreDisplay({
  confidence,
  breakdown,
  band,
  compact = false,
}: ConfidenceScoreDisplayProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (confidence === undefined || confidence === null) return null;

  const norm = normalizeConfidence(confidence);
  const pct = Math.round(norm * 100);
  const resolvedBand = band || getBand(norm);
  const config = BAND_CONFIG[resolvedBand];

  if (compact) {
    return <ConfidenceBadge confidence={norm} band={resolvedBand} />;
  }

  return (
    <div className="space-y-2">
      {/* Overall score */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Confidence:</span>
        <Badge variant="outline" className={config.badgeClass}>
          {pct}% — {config.label}
        </Badge>
      </div>

      {/* Breakdown (collapsible) */}
      {breakdown && (
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Score Breakdown
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <div className="space-y-2 pl-2 border-l-2 border-muted">
              {(Object.keys(FACTOR_LABELS) as (keyof ConfidenceBreakdown)[]).map((factor) => {
                const value = breakdown[factor];
                const status = getFactorStatus(value);
                const color = getFactorColor(value);

                return (
                  <div key={factor} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {FACTOR_LABELS[factor]} <span className="opacity-60">({FACTOR_WEIGHTS[factor]})</span>
                      </span>
                      <span className={color}>
                        {value}% {status}
                      </span>
                    </div>
                    <Progress value={value} className="h-1.5" />
                  </div>
                );
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

export default ConfidenceScoreDisplay;