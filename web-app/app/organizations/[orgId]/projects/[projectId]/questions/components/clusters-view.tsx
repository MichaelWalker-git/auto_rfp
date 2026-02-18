'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Link, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useClusters } from '@/lib/hooks/use-clustering';
import { QuestionCluster, ClusterMember } from '@auto-rfp/shared';
import { useState } from 'react';

interface ClustersViewProps {
  projectId: string;
  onSelectQuestion: (questionId: string) => void;
  selectedQuestion: string | null;
  answers: Record<string, { text?: string }>;
}

export function ClustersView({
  projectId,
  onSelectQuestion,
  selectedQuestion,
  answers,
}: ClustersViewProps) {
  const { data, isLoading, error } = useClusters(projectId);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  const clusters = data?.clusters ?? [];

  const toggleCluster = (clusterId: string) => {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(clusterId)) {
        next.delete(clusterId);
      } else {
        next.add(clusterId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedClusters(new Set(clusters.map((c) => c.clusterId)));
  };

  const collapseAll = () => {
    setExpandedClusters(new Set());
  };

  const hasAnswer = (questionId: string) => {
    const text = answers[questionId]?.text;
    return typeof text === 'string' && text.trim().length > 0;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading clusters...</span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-red-600">
          Failed to load clusters. Please try again.
        </CardContent>
      </Card>
    );
  }

  if (clusters.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Link className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
          <h3 className="text-lg font-medium text-muted-foreground mb-2">No Clusters Found</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Similar questions are automatically grouped into clusters when you process documents.
            Questions with 80%+ similarity will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalQuestionsInClusters = clusters.reduce((sum, c) => sum + c.members.length, 0);

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Link className="h-5 w-5 text-blue-600" />
                Question Clusters
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {clusters.length} cluster{clusters.length !== 1 ? 's' : ''} • {totalQuestionsInClusters} grouped questions
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={expandAll}>
                Expand All
              </Button>
              <Button variant="outline" size="sm" onClick={collapseAll}>
                Collapse All
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Cluster list */}
      {clusters.map((cluster: QuestionCluster) => {
        const isExpanded = expandedClusters.has(cluster.clusterId);
        const masterHasAnswer = hasAnswer(cluster.masterQuestionId);
        const answeredCount = cluster.members.filter((m: ClusterMember) => hasAnswer(m.questionId)).length;

        return (
          <Collapsible
            key={cluster.clusterId}
            open={isExpanded}
            onOpenChange={() => toggleCluster(cluster.clusterId)}
          >
            <Card className="border-l-4 border-l-blue-500">
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-sm line-clamp-2">
                          {cluster.masterQuestionText}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            {cluster.members.length} questions
                          </Badge>
                          <Badge
                            variant="outline"
                            className="text-xs bg-blue-50 text-blue-700"
                          >
                            {Math.round(cluster.avgSimilarity * 100)}% avg similarity
                          </Badge>
                          {answeredCount > 0 && (
                            <Badge
                              variant="outline"
                              className="text-xs bg-green-50 text-green-700"
                            >
                              {answeredCount}/{cluster.members.length} answered
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <CardContent className="pt-0">
                  <div className="space-y-2 pl-7">
                    {cluster.members.map((member: ClusterMember) => {
                      const isSelected = member.questionId === selectedQuestion;
                      const isMaster = member.questionId === cluster.masterQuestionId;
                      const memberHasAnswer = hasAnswer(member.questionId);

                      return (
                        <div
                          key={member.questionId}
                          className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-blue-100 border border-blue-300'
                              : 'bg-muted/30 hover:bg-muted/60 border border-transparent'
                          }`}
                          onClick={() => onSelectQuestion(member.questionId)}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm line-clamp-1">{member.questionText}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {!isMaster && <span className="text-xs text-muted-foreground">
                                {Math.round(member.similarity * 100)}% similar
                              </span>}
                              {isMaster && (
                                <Badge variant="secondary" className="text-xs py-0 h-4">
                                  Master
                                </Badge>
                              )}
                              {memberHasAnswer && (
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        );
      })}
    </div>
  );
}