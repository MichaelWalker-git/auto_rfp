'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  ChevronRight,
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
  { key: 'PAST_PERFORMANCE_RELEVANCE', label: 'Past Performance', icon: Briefcase, weight: 0.25 },
  { key: 'STRATEGIC_ALIGNMENT', label: 'Strategic Fit', icon: Target, weight: 0.25 },
  { key: 'TECHNICAL_FIT', label: 'Technical Fit', icon: TrendingUp, weight: 0.20 },
  { key: 'PRICING_POSITION', label: 'Pricing', icon: DollarSign, weight: 0.15 },
  { key: 'INCUMBENT_RISK', label: 'Incumbent Risk', icon: Shield, weight: 0.15 },
];

const scoreColor = (score: number) => {
  if (score >= 4) return 'text-green-600';
  if (score >= 3) return 'text-yellow-600';
  return 'text-red-600';
};

const scoreBarColor = (score: number) => {
  if (score >= 4) return 'bg-green-500';
  if (score >= 3) return 'bg-yellow-500';
  return 'bg-red-500';
};

const scoreBarBg = (score: number) => {
  if (score >= 4) return 'bg-green-100 dark:bg-green-950/30';
  if (score >= 3) return 'bg-yellow-100 dark:bg-yellow-950/30';
  return 'bg-red-100 dark:bg-red-950/30';
};

const decisionConfig = (decision?: string) => {
  switch (decision) {
    case 'GO':
      return { label: 'Go', color: 'bg-green-600 text-white', icon: CheckCircle2, description: 'Pursue this opportunity aggressively' };
    case 'CONDITIONAL_GO':
      return { label: 'Review Required', color: 'bg-yellow-500 text-white', icon: AlertTriangle, description: 'Proceed with conditions — resolve blockers first' };
    case 'NO_GO':
      return { label: 'No Go', color: 'bg-red-600 text-white', icon: XCircle, description: 'Do not pursue this opportunity' };
    default:
      return { label: 'Pending', color: 'bg-muted text-muted-foreground', icon: Target, description: 'Scoring not yet complete' };
  }
};

export const ScoringGrid = ({ scoring }: { scoring: ScoringSection | undefined | null }) => {
  if (!scoring) return null;

  const criteriaList = scoring.criteria ?? [];
  const compositeScore = scoring.compositeScore ?? 0;
  const confidence = scoring.confidence ?? 0;
  const decision = decisionConfig(scoring.decision);
  const DecisionIcon = decision.icon;

  const getCriterion = (key: string) => criteriaList.find((c) => c.name === key);

  const hasBlockers = (scoring.blockers?.length ?? 0) > 0;
  const hasActions = (scoring.requiredActions?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Hero: Decision + Composite Score */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Decision Badge */}
        <Card className="md:col-span-2">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className={`flex items-center justify-center w-14 h-14 rounded-xl ${decision.color}`}>
                <DecisionIcon className="h-7 w-7" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-2xl font-bold">{decision.label}</h2>
                  <Badge variant="outline" className="text-sm">
                    {confidence}% confidence
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{decision.description}</p>
                {scoring.decisionRationale && (
                  <p className="text-sm mt-3 leading-relaxed">{scoring.decisionRationale}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Composite Score */}
        <Card>
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center">
            <span className={`text-5xl font-bold ${scoreColor(compositeScore)}`}>
              {compositeScore.toFixed(1)}
            </span>
            <span className="text-sm text-muted-foreground mt-1">out of 5.0</span>
            <div className="w-full mt-3 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${scoreBarColor(compositeScore)}`}
                style={{ width: `${(compositeScore / 5) * 100}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Scoring Criteria Breakdown */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Scoring Breakdown</h3>
        {CRITERIA_DEFS.map((def) => {
          const criterion = getCriterion(def.key);
          const score = criterion?.score ?? 0;
          const Icon = def.icon;

          return (
            <div key={def.key} className={`rounded-lg p-4 ${scoreBarBg(score)}`}>
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{def.label}</span>
                      <span className="text-xs text-muted-foreground">({Math.round(def.weight * 100)}% weight)</span>
                    </div>
                    <span className={`text-lg font-bold ${scoreColor(score)}`}>{score}/5</span>
                  </div>
                  {/* Score bar */}
                  <div className="w-full h-1.5 rounded-full bg-background/50 overflow-hidden mb-2">
                    <div
                      className={`h-full rounded-full transition-all ${scoreBarColor(score)}`}
                      style={{ width: `${(score / 5) * 100}%` }}
                    />
                  </div>
                  {criterion?.rationale && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{criterion.rationale}</p>
                  )}
                  {(criterion?.gaps?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {criterion?.gaps?.map((g: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs font-normal">
                          {g}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action Items — Blockers & Required Actions */}
      {(hasBlockers || hasActions) && (
        <div className="grid gap-4 md:grid-cols-2">
          {hasBlockers && (
            <Card className="border-red-200 dark:border-red-900">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-400">
                  <XCircle className="h-4 w-4" />
                  Blockers ({scoring.blockers?.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {scoring.blockers?.map((b: string, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <ChevronRight className="h-4 w-4 mt-0.5 text-red-500 flex-shrink-0" />
                    <span>{b}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {hasActions && (
            <Card className="border-yellow-200 dark:border-yellow-900">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle className="h-4 w-4" />
                  Required Actions ({scoring.requiredActions?.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {scoring.requiredActions?.map((a: string, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <ChevronRight className="h-4 w-4 mt-0.5 text-yellow-500 flex-shrink-0" />
                    <span>{a}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Confidence Drivers */}
      {(scoring.confidenceDrivers?.length ?? 0) > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3">Confidence Drivers</h3>
          {scoring.confidenceExplanation && (
            <p className="text-sm text-muted-foreground mb-3">{scoring.confidenceExplanation}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {scoring.confidenceDrivers?.map((d, i: number) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded border text-sm">
                {d.direction === 'UP' ? (
                  <TrendingUp className="h-4 w-4 text-green-600 flex-shrink-0" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-600 flex-shrink-0" />
                )}
                <span className="text-muted-foreground">{d.factor}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Justification */}
      {scoring.summaryJustification && (
        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-2">Summary Justification</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{scoring.summaryJustification}</p>
        </div>
      )}
    </div>
  );
};
