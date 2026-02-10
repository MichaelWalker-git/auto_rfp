'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, AlertTriangle, CheckCircle2, Lightbulb, Target, TrendingUp, Users, XCircle } from 'lucide-react';
import type { GapAnalysis, RequirementCoverage } from '@auto-rfp/shared';

interface GapAnalysisCardProps {
  gapAnalysis?: GapAnalysis | null;
}

export function GapAnalysisCard({ gapAnalysis }: GapAnalysisCardProps) {
  if (!gapAnalysis) {
    return null;
  }

  const { coverageItems, overallCoverage, criticalGaps, recommendations } = gapAnalysis;

  const coveredCount = coverageItems.filter(c => c.status === 'COVERED').length;
  const partialCount = coverageItems.filter(c => c.status === 'PARTIAL').length;
  const gapCount = coverageItems.filter(c => c.status === 'GAP').length;

  const getCoverageColor = (coverage: number) => {
    if (coverage >= 80) return 'text-green-600';
    if (coverage >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getCoverageProgressColor = (coverage: number) => {
    if (coverage >= 80) return 'bg-green-500';
    if (coverage >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5"/>
            <CardTitle>Requirements Coverage Analysis</CardTitle>
          </div>
          <Badge
            variant={overallCoverage >= 70 ? 'default' : overallCoverage >= 50 ? 'secondary' : 'destructive'}
            className="text-sm"
          >
            {overallCoverage}% Coverage
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Coverage Summary */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Overall Coverage</span>
            <span className={`font-semibold ${getCoverageColor(overallCoverage)}`}>
              {overallCoverage}%
            </span>
          </div>
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full ${getCoverageProgressColor(overallCoverage)} transition-all`}
              style={{ width: `${overallCoverage}%` }}
            />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 pt-2">
            <div className="text-center p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
              <div className="flex items-center justify-center gap-1.5 text-green-600 mb-1">
                <CheckCircle2 className="h-4 w-4"/>
                <span className="font-semibold text-lg">{coveredCount}</span>
              </div>
              <div className="text-xs text-muted-foreground">Covered</div>
            </div>
            <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg">
              <div className="flex items-center justify-center gap-1.5 text-yellow-600 mb-1">
                <AlertTriangle className="h-4 w-4"/>
                <span className="font-semibold text-lg">{partialCount}</span>
              </div>
              <div className="text-xs text-muted-foreground">Partial</div>
            </div>
            <div className="text-center p-3 bg-red-50 dark:bg-red-950/20 rounded-lg">
              <div className="flex items-center justify-center gap-1.5 text-red-600 mb-1">
                <XCircle className="h-4 w-4"/>
                <span className="font-semibold text-lg">{gapCount}</span>
              </div>
              <div className="text-xs text-muted-foreground">Gaps</div>
            </div>
          </div>
        </div>

        {/* Critical Gaps Alert */}
        {criticalGaps.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4"/>
            <AlertTitle>Critical Gaps Identified</AlertTitle>
            <div className="col-start-2">
              <ul className="list-disc list-inside mt-2 space-y-1">
                {criticalGaps.slice(0, 5).map((gap, i) => (
                  <li key={i} className="text-sm">
                    {gap.length > 100 ? gap.slice(0, 100) + '...' : gap}
                  </li>
                ))}
                {criticalGaps.length > 5 && (
                  <li className="text-sm font-medium">
                    +{criticalGaps.length - 5} more critical gaps
                  </li>
                )}
              </ul>
            </div>
          </Alert>
        )}

        {/* Coverage Details */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4"/>
            Coverage by Requirement
          </p>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {coverageItems.map((item, index) => (
              <CoverageItemRow key={index} item={item}/>
            ))}
          </div>
        </div>

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Lightbulb className="h-4 w-4"/>
              Recommendations
            </p>
            <div className="space-y-2">
              {recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
                  <Users className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0"/>
                  <p className="text-sm">{rec}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface CoverageItemRowProps {
  item: RequirementCoverage;
}

function CoverageItemRow({ item }: CoverageItemRowProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COVERED':
        return <CheckCircle2 className="h-4 w-4 text-green-600"/>;
      case 'PARTIAL':
        return <AlertTriangle className="h-4 w-4 text-yellow-600"/>;
      case 'GAP':
        return <XCircle className="h-4 w-4 text-red-600"/>;
      default:
        return null;
    }
  };

  const getStatusBadgeVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (status) {
      case 'COVERED':
        return 'default';
      case 'PARTIAL':
        return 'secondary';
      case 'GAP':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  return (
    <div className="flex items-start gap-3 p-3 border rounded-lg">
      <div className="flex-shrink-0 mt-0.5">
        {getStatusIcon(item.status)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {item.requirement.length > 80 ? item.requirement.slice(0, 80) + '...' : item.requirement}
            </p>
            {item.category && (
              <Badge variant="outline" className="text-xs mt-1">
                {item.category}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {item.matchScore !== null && item.matchScore !== undefined && (
              <span className="text-xs text-muted-foreground">
                {item.matchScore}%
              </span>
            )}
            <Badge variant={getStatusBadgeVariant(item.status)} className="text-xs">
              {item.status}
            </Badge>
          </div>
        </div>
        {item.matchedProjectTitle && (
          <span className="text-xs text-muted-foreground mt-1 block">
            Matched: {item.matchedProjectTitle}
          </span>
        )}
        {item.recommendation && item.status !== 'COVERED' && (
          <span className="text-xs text-muted-foreground mt-1 italic block">
            💡 {item.recommendation}
          </span>
        )}
      </div>
    </div>
  );
}

export default GapAnalysisCard;