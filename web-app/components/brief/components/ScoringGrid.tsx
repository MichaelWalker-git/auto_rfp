'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Target, TrendingUp, Users, Clock, AlertTriangle } from 'lucide-react';

export function ScoringGrid({ scoring }: { scoring: any }) {
  if (!scoring) return null;

  // Extract the 4 main scoring dimensions from criteria
  const capabilityScore = scoring?.criteria?.find((c: any) => c.name === 'TECHNICAL_FIT')?.score ?? 3;
  const scheduleScore = scoring?.criteria?.find((c: any) => c.name === 'SCHEDULE')?.score ?? 3;
  const winProbScore = scoring?.criteria?.find((c: any) => c.name === 'WIN_PROBABILITY')?.score ?? 3;
  const resourceScore = scoring?.criteria?.find((c: any) => c.name === 'RESOURCE')?.score ?? 3;

  const compositeScore = scoring?.compositeScore ?? Math.round(((capabilityScore + scheduleScore + winProbScore + resourceScore) / 4) * 10) / 10;

  return (
    <div className="space-y-6">
      {/* Four Dimension Scoring */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Opportunity Scoring Dimensions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="border rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              <span className="text-sm font-medium">Capability</span>
            </div>
            <div className="ml-6">
              <Badge variant={capabilityScore >= 4 ? 'default' : capabilityScore <= 2 ? 'destructive' : 'secondary'} className="text-base px-3 py-1">
                {capabilityScore}/5
              </Badge>
              <p className="text-xs text-muted-foreground mt-1">Technical fit & alignment</p>
            </div>
          </div>

          <div className="border rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span className="text-sm font-medium">Schedule</span>
            </div>
            <div className="ml-6">
              <Badge variant={scheduleScore >= 4 ? 'default' : scheduleScore <= 2 ? 'destructive' : 'secondary'} className="text-base px-3 py-1">
                {scheduleScore}/5
              </Badge>
              <p className="text-xs text-muted-foreground mt-1">Deadline feasibility</p>
            </div>
          </div>

          <div className="border rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              <span className="text-sm font-medium">Win Prob</span>
            </div>
            <div className="ml-6">
              <Badge variant={winProbScore >= 4 ? 'default' : winProbScore <= 2 ? 'destructive' : 'secondary'} className="text-base px-3 py-1">
                {winProbScore}/5
              </Badge>
              <p className="text-xs text-muted-foreground mt-1">Competitive positioning</p>
            </div>
          </div>

          <div className="border rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span className="text-sm font-medium">Resources</span>
            </div>
            <div className="ml-6">
              <Badge variant={resourceScore >= 4 ? 'default' : resourceScore <= 2 ? 'destructive' : 'secondary'} className="text-base px-3 py-1">
                {resourceScore}/5
              </Badge>
              <p className="text-xs text-muted-foreground mt-1">Staffing availability</p>
            </div>
          </div>
        </div>
      </div>

      {/* Overall Score */}
      <div className="border-l-4 pl-4 py-2 space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Overall Weighted Score</h3>
          <span className="text-4xl font-bold">{compositeScore.toFixed(1)}/5.0</span>
        </div>
        <p className="text-xs text-muted-foreground">(Capability 25% + Schedule 20% + Win Prob 35% + Resources 20%)</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="font-semibold">4.0+</span>: STRONG GO</div>
          <div><span className="font-semibold">3.0-3.9</span>: GO / CONDITIONAL_GO</div>
          <div><span className="font-semibold">2.0-2.9</span>: CONDITIONAL_GO</div>
          <div><span className="font-semibold">&lt;2.0</span>: NO_GO</div>
        </div>
      </div>

      {/* Detailed Criteria */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Detailed Scoring Criteria</h3>
        {scoring?.summaryJustification && (
          <p className="text-sm text-muted-foreground mb-4 border-l-4 pl-3">{scoring.summaryJustification}</p>
        )}
        <div className="grid gap-3 md:grid-cols-5">
          {(scoring?.criteria ?? []).map((c: any) => (
            <div key={c.name} className="border rounded-lg p-4 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wide font-semibold mb-2">
                  {String(c.name).replace(/_/g, ' ')}
                </p>
                <Badge
                  variant={c.score >= 4 ? 'default' : c.score <= 2 ? 'destructive' : 'secondary'}
                  className="text-base px-3 py-1"
                >
                  {c.score}/5
                </Badge>
              </div>

              <p className="text-xs leading-relaxed">{c.rationale}</p>

              {c.gaps?.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-medium hover:underline">
                    Gaps ({c.gaps.length})
                  </summary>
                  <ul className="list-disc pl-4 mt-2 space-y-1 text-muted-foreground">
                    {c.gaps.map((g: string, i: number) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Blockers and Required Actions */}
      {(scoring?.blockers?.length > 0 || scoring?.requiredActions?.length > 0) && (
        <Card className="border-2 border-dashed">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Critical Blockers & Required Actions
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-2">Must be addressed before proceeding with bid</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {scoring?.blockers?.length > 0 && (
              <div className="border-l-4 pl-3">
                <p className="font-semibold text-sm mb-2">Go/No-Go Blockers:</p>
                <ul className="space-y-2">
                  {scoring.blockers.map((b: string, i: number) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{i + 1}.</span> {b}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {scoring?.requiredActions?.length > 0 && (
              <div className="border-l-4 pl-3 pt-3">
                <p className="font-semibold text-sm mb-2">Required Actions Before Bid:</p>
                <ol className="space-y-2">
                  {scoring.requiredActions.map((a: string, i: number) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{i + 1}.</span> {a}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Confidence Drivers */}
      {scoring?.confidenceDrivers?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Confidence & Key Drivers</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Factors influencing this assessment</p>
            {scoring?.confidenceExplanation && (
              <p className="text-sm mt-3 border-l-4 pl-3">{scoring.confidenceExplanation}</p>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {scoring.confidenceDrivers.map((d: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 border rounded">
                  {d.direction === 'UP' ? (
                    <TrendingUp className="h-5 w-5 mt-0.5 flex-shrink-0" />
                  ) : (
                    <div className="transform rotate-180">
                      <TrendingUp className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">
                      {d.direction === 'UP' ? 'Positive Driver' : 'Risk Factor'}
                    </p>
                    <p className="text-sm">{d.factor}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
