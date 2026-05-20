'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronRight, Copy, Link, CheckCircle2, Loader2, ArrowDownToLine } from 'lucide-react';
import { useSimilarQuestions, useApplyClusterAnswer } from '@/lib/hooks/use-clustering';
import { toast } from '@/components/ui/use-toast';
import PermissionWrapper from '@/components/permission-wrapper';
import { useOrganization } from '@/lib/hooks/use-api';
import { DEFAULT_CLUSTER_THRESHOLD } from '@/lib/constants';

interface SimilarQuestionsPanelProps {
  projectId: string;
  opportunityId: string;
  questionFileId?: string;
  questionId: string;
  currentAnswer?: string;
  isUnsaved?: boolean;
  onSelectQuestion?: (questionId: string) => void;
  onAnswerApplied?: (targetQuestionIds: string[], answerText: string) => void;
  /** Callback when user wants to use a similar question's answer for the current question */
  onUseAnswer?: (answerText: string) => void;
}

export const SimilarQuestionsPanel = ({
  projectId,
  opportunityId,
  questionFileId,
  questionId,
  currentAnswer,
  isUnsaved = false,
  onSelectQuestion,
  onAnswerApplied,
  onUseAnswer,
}: SimilarQuestionsPanelProps) => {
  // Get orgId from URL params instead of prop drilling
  const params = useParams();
  const rawOrgId = params.orgId;
  const orgId = Array.isArray(rawOrgId) ? rawOrgId[0] : rawOrgId ?? '';
  
  const [isOpen, setIsOpen] = useState(false);
  const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set());
  // Track when we just copied an answer to suppress the "save first" warning briefly
  const [justCopiedAnswer, setJustCopiedAnswer] = useState(false);
  
  // Get org settings for cluster threshold
  const { data: orgData } = useOrganization(orgId);
  const clusterThreshold = orgData?.clusterThreshold ?? DEFAULT_CLUSTER_THRESHOLD;
  
  const { data, isLoading, error } = useSimilarQuestions(projectId, questionId, {
    threshold: clusterThreshold,
    limit: 10,
    orgId,
    opportunityId,
    fileId: questionFileId,
  });
  
  const { trigger: applyAnswer, isMutating: isApplying } = useApplyClusterAnswer();
  
  const similarQuestions = data?.similarQuestions ?? [];
  const hasLoaded = !isLoading && data !== undefined;
  const hasNoSimilar = hasLoaded && similarQuestions.length === 0;
  
  const handleToggleQuestion = (qId: string) => {
    setSelectedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(qId)) {
        next.delete(qId);
      } else {
        next.add(qId);
      }
      return next;
    });
  };
  
  const handleSelectAll = () => {
    if (selectedQuestions.size === similarQuestions.length) {
      setSelectedQuestions(new Set());
    } else {
      setSelectedQuestions(new Set(similarQuestions.map((q) => q.questionId)));
    }
  };
  
  const handleApplyAnswer = async () => {
    if (!currentAnswer?.trim()) {
      toast({
        title: 'No answer to apply',
        description: 'Please write an answer first before applying to similar questions.',
        variant: 'destructive',
      });
      return;
    }
    
    if (selectedQuestions.size === 0) {
      toast({
        title: 'No questions selected',
        description: 'Select at least one question to apply the answer to.',
        variant: 'destructive',
      });
      return;
    }
    
    try {
      const result = await applyAnswer({
        orgId,
        projectId,
        opportunityId,
        questionFileId,
        sourceQuestionId: questionId,
        targetQuestionIds: Array.from(selectedQuestions),
      });
      
      if (result?.applied && result.applied.length > 0) {
        toast({
          title: 'Answer applied',
          description: `Successfully applied answer to ${result.applied.length} question(s).`,
        });
        
        // Update local state for the applied questions
        if (onAnswerApplied && currentAnswer) {
          onAnswerApplied(result.applied, currentAnswer);
        }
        
        setSelectedQuestions(new Set());
      }
      
      if (result?.failed && result.failed.length > 0) {
        toast({
          title: 'Some applications failed',
          description: `Failed to apply to ${result.failed.length} question(s).`,
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to apply answer to similar questions.',
        variant: 'destructive',
      });
    }
  };
  
  const getSimilarityColor = (similarity: number) => {
    if (similarity >= 0.9) return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-400';
    if (similarity >= 0.8) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-400';
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-400';
  };
  
  // Only allow opening if there are similar questions
  const handleOpenChange = (open: boolean) => {
    if (hasNoSimilar) return; 
    setIsOpen(open);
  };
  
  return (
    <Collapsible open={isOpen && !hasNoSimilar} onOpenChange={handleOpenChange}>
      <Card className="border-dashed border-primary/30 bg-primary/5 py-3">
        <CardHeader 
          className={`transition-colors ${hasNoSimilar || isLoading ? 'cursor-default' : 'cursor-pointer hover:bg-primary/10'}`}
          onClick={() => !hasNoSimilar && !isLoading && handleOpenChange(!isOpen)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {hasNoSimilar || isLoading ? (
                <span className="h-4 w-4" /> // Placeholder for alignment
              ) : isOpen ? (
                <ChevronDown className="h-4 w-4 text-primary" />
              ) : (
                <ChevronRight className="h-4 w-4 text-primary" />
              )}
              <Link className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm text-primary">
                Similar Questions
              </CardTitle>
            </div>
            
            {isLoading ? (
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-12" />
              </div>
            ) : hasNoSimilar ? (
              <span className="text-xs text-muted-foreground">No similar questions found</span>
            ) : (
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                {similarQuestions.length} found
              </Badge>
            )}
          </div>
        </CardHeader>
        
        {/* Only render content area if there are similar questions */}
        {similarQuestions.length > 0 && (
          <CollapsibleContent>
            <CardContent className="pt-0">
              {error && (
                <p className="text-sm text-red-600">
                  Failed to load similar questions
                </p>
              )}
              
              <div className="space-y-3">
                {/* Select all + Apply button */}
                <div className="flex items-center justify-between pb-2 border-b">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedQuestions.size === similarQuestions.length}
                      onCheckedChange={handleSelectAll}
                      id="select-all"
                    />
                    <label htmlFor="select-all" className="text-xs text-muted-foreground cursor-pointer">
                      Select all ({similarQuestions.length})
                    </label>
                  </div>
                  
                  <PermissionWrapper requiredPermission="answer:edit">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs"
                      onClick={handleApplyAnswer}
                      disabled={isApplying || selectedQuestions.size === 0 || !currentAnswer?.trim() || isUnsaved}
                      title={
                        !currentAnswer?.trim()
                          ? 'Write an answer first, then apply it to selected similar questions'
                          : isUnsaved
                            ? 'Save your answer first before applying to similar questions'
                            : 'Copy your answer to the selected similar questions'
                      }
                    >
                      {isApplying ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Applying...
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Apply Answer ({selectedQuestions.size})
                        </>
                      )}
                    </Button>
                  </PermissionWrapper>
                </div>
                
                {/* Question list */}
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {similarQuestions.map((sq) => (
                    <div
                      key={sq.questionId}
                      className={`flex items-start gap-2 p-2 rounded-md border ${
                        selectedQuestions.has(sq.questionId)
                          ? 'bg-primary/10 border-primary/30'
                          : 'bg-card border-border'
                      }`}
                    >
                      <Checkbox
                        checked={selectedQuestions.has(sq.questionId)}
                        onCheckedChange={() => handleToggleQuestion(sq.questionId)}
                        className="mt-1"
                      />
                      
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm text-foreground line-clamp-2 cursor-pointer hover:text-primary"
                          onClick={() => onSelectQuestion?.(sq.questionId)}
                          title="Click to view this question"
                        >
                          {sq.questionText}
                        </p>
                        
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge
                            variant="outline"
                            className={`text-xs ${getSimilarityColor(sq.similarity)}`}
                          >
                            {Math.round(sq.similarity * 100)}% similar
                          </Badge>
                          
                          {sq.sectionTitle && (
                            <span className="text-xs text-muted-foreground truncate">
                              {sq.sectionTitle}
                            </span>
                          )}
                          
                          {sq.hasAnswer && (
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                          )}
                          
                          {/* Use this answer button - shown when similar question has an answer */}
                          {sq.hasAnswer && sq.answerText && onUseAnswer && (
                            <PermissionWrapper requiredPermission="answer:edit">
                              <Badge
                                variant="outline"
                                className="text-xs bg-primary/10 text-primary border-primary/30 hover:bg-primary/20 cursor-pointer gap-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Suppress the "save first" warning briefly when copying answer
                                  setJustCopiedAnswer(true);
                                  setTimeout(() => setJustCopiedAnswer(false), 4000);
                                  onUseAnswer(sq.answerText!);
                                  toast({
                                    title: 'Answer applied',
                                    description: 'The similar question\'s answer has been copied to your editor.',
                                  });
                                }}
                                title="Use this answer for the current question"
                              >
                                <ArrowDownToLine className="h-3 w-3" />
                                Use this answer
                              </Badge>
                            </PermissionWrapper>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
              {!currentAnswer?.trim() ? (
                <p className="text-xs text-muted-foreground italic">
                  Write an answer above to apply it to similar questions
                </p>
              ) : isUnsaved && !justCopiedAnswer ? (
                <p className="text-xs text-amber-600 italic">
                  ⚠️ Save your answer first before applying to similar questions
                </p>
              ) : null}
            </div>
            </CardContent>
          </CollapsibleContent>
        )}
      </Card>
    </Collapsible>
  );
}