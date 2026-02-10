'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Briefcase, Building2, Calendar, DollarSign, Loader2, RefreshCw, Star, Users } from 'lucide-react';
import type { PastPerformanceSection, PastProjectMatch } from '@auto-rfp/shared';

interface PastPerformanceCardProps {
  pastPerformance?: PastPerformanceSection | null;
  onRegenerate?: (force: boolean) => Promise<void>;
  isRegenerating?: boolean;
}

export function PastPerformanceCard({ pastPerformance, onRegenerate, isRegenerating }: PastPerformanceCardProps) {
  if (!pastPerformance) {
    return (
      <Card className="border-2">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Briefcase className="h-5 w-5"/>
              <CardTitle>Past Performance</CardTitle>
            </div>
            {onRegenerate && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => onRegenerate(true)}
                disabled={isRegenerating}
              >
                {isRegenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin"/>
                    Matching...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2"/>
                    Match Projects
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg p-6 text-center">
            <Briefcase className="h-6 w-6 mx-auto mb-2 text-muted-foreground"/>
            <p className="text-sm text-muted-foreground">
              No past performance analysis available. Click &quot;Match Projects&quot; to find relevant projects.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { topMatches, narrativeSummary, confidenceScore } = pastPerformance;

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5"/>
            <CardTitle>Past Performance</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {confidenceScore !== undefined && confidenceScore !== null && (
              <Badge variant={confidenceScore >= 70 ? 'default' : confidenceScore >= 50 ? 'secondary' : 'destructive'}>
                {confidenceScore}% Confidence
              </Badge>
            )}
            {onRegenerate && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => onRegenerate(true)}
                disabled={isRegenerating}
              >
                {isRegenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin"/>
                    Matching...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2"/>
                    Re-match
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary */}
        {narrativeSummary && (
          <div className="border-l-4 pl-4 py-2">
            <p className="text-sm leading-relaxed">{narrativeSummary}</p>
          </div>
        )}

        {/* Top Matches */}
        {topMatches && topMatches.length > 0 ? (
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Top Matching Projects ({topMatches.length})
            </p>
            {topMatches.map((match, index) => (
              <ProjectMatchCard key={match.project.projectId} match={match} rank={index + 1}/>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Briefcase className="h-12 w-12 mx-auto mb-4 opacity-50"/>
            <span className="text-sm block">No matching past projects found.</span>
            <span className="text-xs mt-1 block">Consider adding past projects to your database.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ProjectMatchCardProps {
  match: PastProjectMatch;
  rank: number;
}

function ProjectMatchCard({ match, rank }: ProjectMatchCardProps) {
  const { project, relevanceScore, matchDetails, matchedRequirements } = match;

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBadgeVariant = (score: number): 'default' | 'secondary' | 'destructive' => {
    if (score >= 80) return 'default';
    if (score >= 60) return 'secondary';
    return 'destructive';
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold text-sm">
            #{rank}
          </div>
          <div>
            <h5 className="font-medium">{project.title}</h5>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-3 w-3"/>
              {project.client}
            </div>
          </div>
        </div>
        <Badge variant={getScoreBadgeVariant(relevanceScore)}>
          {relevanceScore}% Match
        </Badge>
      </div>

      {/* Project Details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        {project.value && (
          <div className="flex items-center gap-1.5">
            <DollarSign className="h-3.5 w-3.5 text-muted-foreground"/>
            <span>${(project.value / 1000000).toFixed(1)}M</span>
          </div>
        )}
        {project.startDate && project.endDate && (
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground"/>
            <span>{formatDateRange(project.startDate, project.endDate)}</span>
          </div>
        )}
        {project.teamSize && (
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-muted-foreground"/>
            <span>{project.teamSize} team members</span>
          </div>
        )}
        {project.performanceRating && (
          <div className="flex items-center gap-1.5">
            <Star className="h-3.5 w-3.5 text-yellow-500"/>
            <span>{project.performanceRating}/5 rating</span>
          </div>
        )}
      </div>

      {/* Match Details */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Match Breakdown</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <MatchScoreBar label="Technical" score={matchDetails.technicalSimilarity} weight={40}/>
          <MatchScoreBar label="Domain" score={matchDetails.domainSimilarity} weight={25}/>
          <MatchScoreBar label="Scale" score={matchDetails.scaleSimilarity} weight={20}/>
          <MatchScoreBar label="Recency" score={matchDetails.recency} weight={10}/>
          <MatchScoreBar label="Success" score={matchDetails.successMetrics} weight={5}/>
        </div>
      </div>

      {/* Matched Requirements */}
      {matchedRequirements && matchedRequirements.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Matched Requirements ({matchedRequirements.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {matchedRequirements.slice(0, 5).map((req, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {req.length > 50 ? req.slice(0, 50) + '...' : req}
              </Badge>
            ))}
            {matchedRequirements.length > 5 && (
              <Badge variant="outline" className="text-xs">
                +{matchedRequirements.length - 5} more
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Technologies */}
      {project.technologies && project.technologies.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {project.technologies.slice(0, 6).map((tech, i) => (
            <Badge key={i} variant="secondary" className="text-xs">
              {tech}
            </Badge>
          ))}
          {project.technologies.length > 6 && (
            <Badge variant="secondary" className="text-xs">
              +{project.technologies.length - 6}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

interface MatchScoreBarProps {
  label: string;
  score: number;
  weight: number;
}

function MatchScoreBar({ label, score, weight }: MatchScoreBarProps) {
  const getColor = (s: number) => {
    if (s >= 80) return 'bg-green-500';
    if (s >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{score}%</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${getColor(score)} transition-all`}
          style={{ width: `${score}%` }}
        />
      </div>
      <div className="text-[10px] text-muted-foreground text-right">{weight}% weight</div>
    </div>
  );
}

function formatDateRange(start: string, end: string): string {
  try {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const startStr = startDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const endStr = endDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    return `${startStr} - ${endStr}`;
  } catch {
    return 'N/A';
  }
}

export default PastPerformanceCard;