'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Briefcase,
  Building2,
  Calendar,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Loader2,
  RefreshCw,
  Star,
  Users,
} from 'lucide-react';
import type { PastPerformanceSection, PastProjectMatch } from '@auto-rfp/core';

interface PastPerformanceCardProps {
  pastPerformance?: PastPerformanceSection | null;
  onRegenerate?: (force: boolean) => Promise<void>;
  isRegenerating?: boolean;
}

export function PastPerformanceCard({ pastPerformance, onRegenerate, isRegenerating }: PastPerformanceCardProps) {
  if (!pastPerformance) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Past Performance</CardTitle>
            {onRegenerate && (
              <Button variant="outline" size="sm" onClick={() => onRegenerate(true)} disabled={isRegenerating}>
                {isRegenerating ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin"/>Matching...</>
                ) : (
                  <><RefreshCw className="h-4 w-4 mr-2"/>Match Projects</>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground text-center py-4">
            No past performance analysis available. Click &quot;Match Projects&quot; to find relevant projects.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { topMatches, narrativeSummary, confidenceScore } = pastPerformance;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium">Past Performance</CardTitle>
            {confidenceScore !== undefined && confidenceScore !== null && (
              <Badge
                variant={confidenceScore >= 70 ? 'default' : confidenceScore >= 50 ? 'secondary' : 'destructive'}
                className="text-xs"
              >
                {confidenceScore}%
              </Badge>
            )}
          </div>
          {onRegenerate && (
            <Button variant="outline" size="sm" onClick={() => onRegenerate(true)} disabled={isRegenerating}>
              {isRegenerating ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin"/>Matching...</>
              ) : (
                <><RefreshCw className="h-4 w-4 mr-2"/>Re-match</>
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {narrativeSummary && (
          <p className="text-xs text-muted-foreground leading-relaxed border-l-2 pl-3">
            {narrativeSummary}
          </p>
        )}

        {topMatches && topMatches.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Top Matches ({topMatches.length})
            </p>
            {topMatches.map((match, index) => (
              <ProjectMatchRow key={match.project.projectId} match={match} rank={index + 1} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            No matching past projects found.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const getScoreVariant = (score: number): 'default' | 'secondary' | 'destructive' => {
  if (score >= 80) return 'default';
  if (score >= 60) return 'secondary';
  return 'destructive';
};

const getBarColor = (score: number) => {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-yellow-500';
  return 'bg-red-500';
};

const ProjectMatchRow = ({ match, rank }: { match: PastProjectMatch; rank: number }) => {
  const [expanded, setExpanded] = useState(false);
  const { project, relevanceScore, matchDetails, matchedRequirements } = match;

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Collapsed row */}
      <button
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-xs font-semibold text-muted-foreground w-5 shrink-0">#{rank}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{project.title}</p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {project.client && (
              <span className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {project.client}
              </span>
            )}
            {project.value && (
              <span className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                ${(project.value / 1000000).toFixed(1)}M
              </span>
            )}
            {project.performanceRating && (
              <span className="flex items-center gap-1">
                <Star className="h-3 w-3 text-yellow-500" />
                {project.performanceRating}/5
              </span>
            )}
          </div>
        </div>
        <Badge variant={getScoreVariant(relevanceScore)} className="text-xs shrink-0">
          {relevanceScore}%
        </Badge>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t space-y-2.5">
          {/* Meta row */}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {project.startDate && project.endDate && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {formatDateRange(project.startDate, project.endDate)}
              </span>
            )}
            {project.teamSize && (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {project.teamSize} team
              </span>
            )}
          </div>

          {/* Match breakdown - inline bars */}
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Match Breakdown</p>
            <div className="grid grid-cols-5 gap-1.5">
              {[
                { label: 'Tech', score: matchDetails.technicalSimilarity },
                { label: 'Domain', score: matchDetails.domainSimilarity },
                { label: 'Scale', score: matchDetails.scaleSimilarity },
                { label: 'Recency', score: matchDetails.recency },
                { label: 'Success', score: matchDetails.successMetrics },
              ].map(({ label, score }) => (
                <div key={label}>
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                    <span>{label}</span>
                    <span className="font-medium">{score}%</span>
                  </div>
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${getBarColor(score)}`} style={{ width: `${score}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Matched requirements */}
          {matchedRequirements && matchedRequirements.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {matchedRequirements.slice(0, 4).map((req, i) => (
                <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0">
                  {req.length > 40 ? req.slice(0, 40) + '…' : req}
                </Badge>
              ))}
              {matchedRequirements.length > 4 && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  +{matchedRequirements.length - 4}
                </Badge>
              )}
            </div>
          )}

          {/* Technologies */}
          {project.technologies && project.technologies.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {project.technologies.slice(0, 5).map((tech, i) => (
                <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">
                  {tech}
                </Badge>
              ))}
              {project.technologies.length > 5 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  +{project.technologies.length - 5}
                </Badge>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const formatDateRange = (start: string, end: string): string => {
  try {
    const s = new Date(start).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const e = new Date(end).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    return `${s} – ${e}`;
  } catch {
    return 'N/A';
  }
};

export default PastPerformanceCard;
