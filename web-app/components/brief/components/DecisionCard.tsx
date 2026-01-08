'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, TrendingDown, TrendingUp } from 'lucide-react';
import { recommendationVariant } from '../helpers';

function ConfidenceBadge({ confidence }: { confidence?: number }) {
  const pct = Math.round(confidence ?? 0);
  const variant = pct >= 80 ? 'default' : pct >= 60 ? 'secondary' : 'outline';
  const color = pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-gray-600';

  return (
    <Badge variant={variant} className="gap-1" title="Confidence reflects how strongly the model supports the decision.">
      <span className={color}>●</span>
      {pct}% confidence
    </Badge>
  );
}

function ScoreChangeIndicator({ prev, current }: { prev?: number; current?: number }) {
  if (prev === undefined || current === undefined || prev === current) return null;

  const diff = current - prev;
  const isPositive = diff > 0;

  return (
    <span className={`text-xs flex items-center gap-1 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
      {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {isPositive ? '+' : ''}
      {diff.toFixed(1)}
    </span>
  );
}

export function DecisionCard({
                               projectName,
                               summary,
                               briefItem,
                               previousBrief,
                             }: {
  projectName: string;
  summary: any;
  briefItem: any;
  previousBrief: any;
}) {
  const scoring = briefItem?.sections?.scoring?.data;

  const recommendation = briefItem?.recommendation ?? scoring?.recommendation;
  const decision = briefItem?.decision ?? scoring?.decision;
  const decisionBadge = decision ?? recommendation;

  const confidence = briefItem?.confidence ?? scoring?.confidence;
  const compositeScore = briefItem?.compositeScore ?? scoring?.compositeScore;

  return (
    <Card className="border-2">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap justify-between gap-6">
          <div className="flex-1 space-y-3">
            <CardTitle className="text-2xl">{summary?.title || 'Untitled opportunity'}</CardTitle>

            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              {summary?.agency && <span>{summary.agency}</span>}
              {summary?.naics && <span>• NAICS {summary.naics}</span>}
              {summary?.contractType && <span>• {summary.contractType}</span>}
            </div>

            {typeof summary?.estimatedValueUsd === 'number' && (
              <div className="text-lg font-semibold text-foreground">
                ${summary.estimatedValueUsd.toLocaleString()} USD
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              {summary?.setAside && summary.setAside !== 'UNKNOWN' && (
                <Badge variant="outline" title="Set-aside category for eligibility.">
                  {summary.setAside}
                </Badge>
              )}
              {summary?.placeOfPerformance && (
                <Badge variant="outline" title="Where the work will be performed.">
                  {summary.placeOfPerformance}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="text-xs uppercase text-muted-foreground tracking-wide">Decision</div>

            <Badge
              variant={recommendationVariant(decisionBadge)}
              className="text-lg px-6 py-2"
              title="Final GO / NO-GO recommendation."
            >
              {decisionBadge || '—'}
            </Badge>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-base px-4 py-1" title="Composite score across criteria (1–5).">
                {typeof compositeScore === 'number' ? compositeScore.toFixed(1) : '—'}/5
              </Badge>

              <ScoreChangeIndicator
                prev={previousBrief?.compositeScore ?? previousBrief?.sections?.scoring?.data?.compositeScore}
                current={compositeScore}
              />
            </div>

            <ConfidenceBadge confidence={confidence} />
          </div>
        </div>

        {summary?.summary && (
          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground leading-relaxed">{summary.summary}</p>
          </div>
        )}

        {/* optional: you can add quick metadata row here later */}
        <div className="hidden">{projectName}</div>
      </CardHeader>

      <CardContent className="hidden" />
    </Card>
  );
}