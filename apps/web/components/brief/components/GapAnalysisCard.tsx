'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, AlertTriangle, CheckCircle2, Lightbulb, Target, TrendingUp, Users, XCircle } from 'lucide-react';
import type { GapAnalysis, RequirementCoverage } from '@auto-rfp/core';

interface GapAnalysisCardProps {
  gapAnalysis?: GapAnalysis | null;
}

export function GapAnalysisCard({ gapAnalysis }: GapAnalysisCardProps) {
  if (!gapAnalysis) return null;

  const { coverageItems, overallCoverage, criticalGaps, recommendations } = gapAnalysis;

  const coveredCount = coverageItems.filter(c => c.status === 'COVERED').length;
  const partialCount = coverageItems.filter(c => c.status === 'PARTIAL').length;
  const gapCount = coverageItems.filter(c => c.status === 'GAP').length;

  const barColor = overallCoverage >= 80 ? 'bg-green-500' : overallCoverage >= 60 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Requirements Coverage</CardTitle>
          <Badge
            variant={overallCoverage >= 70 ? 'default' : overallCoverage >= 50 ? 'secondary' : 'destructive'}
            className="text-xs"
          >
            {overallCoverage}% Coverage
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Progress bar + stats inline */}
        <div className="space-y-1.5">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className={`h-full ${barColor} transition-all`} style={{ width: `${overallCoverage}%` }} />
          </div>
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1 text-green-600">
              <CheckCircle2 className="h-3 w-3" /> {coveredCount} covered
            </span>
            <span className="flex items-center gap-1 text-yellow-600">
              <AlertTriangle className="h-3 w-3" /> {partialCount} partial
            </span>
            <span className="flex items-center gap-1 text-red-600">
              <XCircle className="h-3 w-3" /> {gapCount} gaps
            </span>
          </div>
        </div>

        {/* Critical gaps */}
        {criticalGaps.length > 0 && (
          <Alert variant="destructive" className="py-2">
            <AlertCircle className="h-3.5 w-3.5" />
            <AlertTitle className="text-xs">Critical Gaps ({criticalGaps.length})</AlertTitle>
            <ul className="list-disc list-inside mt-1 space-y-0.5 col-start-2">
              {criticalGaps.slice(0, 3).map((gap, i) => (
                <li key={i} className="text-xs">
                  {gap.length > 80 ? gap.slice(0, 80) + '…' : gap}
                </li>
              ))}
              {criticalGaps.length > 3 && (
                <li className="text-xs font-medium">+{criticalGaps.length - 3} more</li>
              )}
            </ul>
          </Alert>
        )}

        {/* Coverage items */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            Coverage by Requirement
          </p>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {coverageItems.map((item, index) => (
              <CoverageRow key={index} item={item} />
            ))}
          </div>
        </div>

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Recommendations
            </p>
            <div className="space-y-1">
              {recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Lightbulb className="h-3 w-3 mt-0.5 shrink-0 text-yellow-500" />
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const statusIcon = (status: string) => {
  switch (status) {
    case 'COVERED': return <CheckCircle2 className="h-3 w-3 text-green-600" />;
    case 'PARTIAL': return <AlertTriangle className="h-3 w-3 text-yellow-600" />;
    case 'GAP': return <XCircle className="h-3 w-3 text-red-600" />;
    default: return null;
  }
};

const statusVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (status) {
    case 'COVERED': return 'default';
    case 'PARTIAL': return 'secondary';
    case 'GAP': return 'destructive';
    default: return 'outline';
  }
};

const CoverageRow = ({ item }: { item: RequirementCoverage }) => (
  <div className="flex items-center gap-2 px-2 py-1.5 border rounded text-xs">
    {statusIcon(item.status)}
    <span className="flex-1 min-w-0 truncate">
      {item.requirement.length > 60 ? item.requirement.slice(0, 60) + '…' : item.requirement}
    </span>
    {item.matchScore !== null && item.matchScore !== undefined && (
      <span className="text-muted-foreground shrink-0">{item.matchScore}%</span>
    )}
    <Badge variant={statusVariant(item.status)} className="text-[10px] px-1 py-0 shrink-0">
      {item.status}
    </Badge>
  </div>
);

export default GapAnalysisCard;
