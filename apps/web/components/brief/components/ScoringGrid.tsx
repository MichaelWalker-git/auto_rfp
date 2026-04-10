'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Target,
  TrendingUp,
  TrendingDown,
  Briefcase,
  DollarSign,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { ScoringSection } from '@auto-rfp/core';

interface CriterionDef {
  key: string;
  label: string;
  icon: LucideIcon;
  weight: number;
}

const CRITERIA_DEFS: CriterionDef[] = [
  { key: 'PAST_PERFORMANCE_RELEVANCE', label: 'Past Performance', icon: Briefcase, weight: 0.30 },
  { key: 'STRATEGIC_ALIGNMENT', label: 'Strategic Fit', icon: Target, weight: 0.25 },
  { key: 'TECHNICAL_FIT', label: 'Technical Fit', icon: TrendingUp, weight: 0.20 },
  { key: 'PRICING_POSITION', label: 'Pricing', icon: DollarSign, weight: 0.15 },
  { key: 'INCUMBENT_RISK', label: 'Incumbent Risk', icon: Shield, weight: 0.10 },
];

const scoreColor = (score: number) => {
  if (score >= 4) return 'text-green-600';
  if (score >= 3) return 'text-yellow-600';
  return 'text-red-600';
};

const barColor = (score: number) => {
  if (score >= 4) return 'bg-green-500';
  if (score >= 3) return 'bg-yellow-500';
  return 'bg-red-500';
};

const decisionVariant = (decision?: string): 'default' | 'secondary' | 'destructive' => {
  if (decision === 'GO') return 'default';
  if (decision === 'NO_GO') return 'destructive';
  return 'secondary';
};

const decisionLabel = (decision?: string) => {
  if (decision === 'GO') return 'Go';
  if (decision === 'NO_GO') return 'No Go';
  if (decision === 'CONDITIONAL_GO') return 'Review Required';
  return 'Pending';
};

export const ScoringGrid = ({ scoring }: { scoring: ScoringSection | undefined | null }) => {
  if (!scoring) return null;

  const criteriaList = scoring.criteria ?? [];
  const compositeScore = scoring.compositeScore ?? 0;
  const confidence = scoring.confidence ?? 0;

  const getCriterion = (key: string) => criteriaList.find((c) => c.name === key);

  return (
    <div className="space-y-3">
      {/* Decision + Score — compact inline header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant={decisionVariant(scoring.decision ?? undefined)} className="text-sm px-3 py-1">
          {decisionLabel(scoring.decision ?? undefined)}
        </Badge>
        <span className={`text-lg font-bold ${scoreColor(compositeScore)}`}>
          {compositeScore.toFixed(1)}/5
        </span>
        <Badge variant="outline" className="text-xs">
          {confidence}% confidence
        </Badge>
      </div>

      {scoring.decisionRationale && (
        <p className="text-xs text-muted-foreground leading-relaxed">{scoring.decisionRationale}</p>
      )}

      {/* Criteria rows */}
      <div className="space-y-1.5">
        {CRITERIA_DEFS.map((def) => {
          const criterion = getCriterion(def.key);
          const score = criterion?.score ?? 0;
          const Icon = def.icon;

          return (
            <div key={def.key} className="flex items-center gap-2 text-xs">
              <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="w-28 shrink-0 font-medium">{def.label}</span>
              <span className="text-muted-foreground w-10 shrink-0 text-right">{Math.round(def.weight * 100)}%</span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${barColor(score)}`}
                  style={{ width: `${(score / 5) * 100}%` }}
                />
              </div>
              <span className={`w-8 text-right font-semibold ${scoreColor(score)}`}>{score}/5</span>
            </div>
          );
        })}
      </div>

      {/* Rationales — collapsed into a compact list */}
      {CRITERIA_DEFS.some((def) => getCriterion(def.key)?.rationale) && (
        <div className="space-y-1">
          {CRITERIA_DEFS.map((def) => {
            const criterion = getCriterion(def.key);
            if (!criterion?.rationale) return null;
            return (
              <div key={def.key} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{def.label}:</span> {criterion.rationale}
              </div>
            );
          })}
        </div>
      )}

      {/* Blockers & Actions — inline lists */}
      {(scoring.blockers?.length ?? 0) > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-red-600 flex items-center gap-1">
            <XCircle className="h-3 w-3" /> Blockers
          </p>
          {scoring.blockers?.map((b: string, i: number) => (
            <p key={i} className="text-xs text-muted-foreground ml-4">• {b}</p>
          ))}
        </div>
      )}

      {(scoring.requiredActions?.length ?? 0) > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-yellow-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Required Actions
          </p>
          {scoring.requiredActions?.map((a: string, i: number) => (
            <p key={i} className="text-xs text-muted-foreground ml-4">• {a}</p>
          ))}
        </div>
      )}

      {/* Confidence drivers */}
      {(scoring.confidenceDrivers?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {scoring.confidenceDrivers?.map((d, i: number) => (
            <Badge key={i} variant="outline" className="text-[10px] gap-1 px-1.5 py-0">
              {d.direction === 'UP' ? (
                <TrendingUp className="h-2.5 w-2.5 text-green-600" />
              ) : (
                <TrendingDown className="h-2.5 w-2.5 text-red-600" />
              )}
              {d.factor}
            </Badge>
          ))}
        </div>
      )}

      {/* Summary */}
      {scoring.summaryJustification && (
        <p className="text-xs text-muted-foreground leading-relaxed border-l-2 pl-3">
          {scoring.summaryJustification}
        </p>
      )}
    </div>
  );
};
