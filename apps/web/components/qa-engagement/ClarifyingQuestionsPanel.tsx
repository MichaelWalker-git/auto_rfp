'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQAEngagementContext } from './qa-engagement-context';
import {
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Send,
  CheckCircle,
  MessageSquare,
  AlertCircle,
} from 'lucide-react';
import type { ClarifyingQuestionItem, ClarifyingQuestionStatus } from '@auto-rfp/core';

const STATUS_COLORS: Record<ClarifyingQuestionStatus, string> = {
  SUGGESTED: 'bg-blue-100 text-blue-800',
  REVIEWED: 'bg-yellow-100 text-yellow-800',
  SUBMITTED: 'bg-indigo-100 text-indigo-800',
  ANSWERED: 'bg-green-100 text-green-800',
  DISMISSED: 'bg-gray-100 text-gray-800',
};

const CATEGORY_COLORS: Record<string, string> = {
  SCOPE: 'bg-purple-100 text-purple-800',
  TECHNICAL: 'bg-cyan-100 text-cyan-800',
  PRICING: 'bg-amber-100 text-amber-800',
  SCHEDULE: 'bg-orange-100 text-orange-800',
  COMPLIANCE: 'bg-red-100 text-red-800',
  EVALUATION: 'bg-emerald-100 text-emerald-800',
  OTHER: 'bg-gray-100 text-gray-800',
};

const PRIORITY_ICONS: Record<string, React.ReactNode> = {
  HIGH: <AlertCircle className="h-4 w-4 text-red-500" />,
  MEDIUM: <MessageSquare className="h-4 w-4 text-yellow-500" />,
  LOW: <MessageSquare className="h-4 w-4 text-gray-400" />,
};

export function ClarifyingQuestionsPanel() {
  const {
    questions,
    questionsLoading,
    questionsError,
    generateQuestions,
    updateQuestion,
    refreshQuestions,
  } = useQAEngagementContext();

  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const handleGenerate = async (force = false) => {
    setIsGenerating(true);
    try {
      await generateQuestions(force);
    } finally {
      setIsGenerating(false);
    }
  };

  const filteredQuestions = questions.filter((q) =>
    statusFilter === 'ALL' ? true : q.status === statusFilter,
  );

  if (questionsLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-500" />
              AI-Generated Clarifying Questions
            </CardTitle>
            <CardDescription>
              Questions to ask during the Q&A period to build relationships
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refreshQuestions}
              disabled={isGenerating}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={() => handleGenerate(questions.length === 0 ? false : true)}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {questions.length === 0 ? 'Generate' : 'Generate more'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {questionsError && (
          <div className="text-destructive text-sm p-3 bg-destructive/10 rounded">
            {questionsError.message}
          </div>
        )}

        {/* Filter */}
        <div className="flex gap-2 items-center">
          <span className="text-sm text-muted-foreground">Filter:</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="SUGGESTED">Suggested</SelectItem>
              <SelectItem value="REVIEWED">Reviewed</SelectItem>
              <SelectItem value="SUBMITTED">Submitted</SelectItem>
              <SelectItem value="ANSWERED">Answered</SelectItem>
              <SelectItem value="DISMISSED">Dismissed</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground ml-2">
            {filteredQuestions.length} questions
          </span>
        </div>

        {/* Questions list */}
        {filteredQuestions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {questions.length === 0 ? (
              <>
                <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>No clarifying questions generated yet.</p>
                <p className="text-sm">Click &quot;Generate&quot; to create AI-powered questions.</p>
              </>
            ) : (
              <p>No questions match the selected filter.</p>
            )}
          </div>
        ) : (
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
            {filteredQuestions.map((question) => (
              <QuestionCard
                key={question.questionId}
                question={question}
                isExpanded={expandedId === question.questionId}
                onToggleExpand={() =>
                  setExpandedId(expandedId === question.questionId ? null : question.questionId)
                }
                onUpdate={updateQuestion}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface QuestionCardProps {
  question: ClarifyingQuestionItem;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (id: string, data: Partial<ClarifyingQuestionItem>) => Promise<void>;
}

function QuestionCard({ question, isExpanded, onToggleExpand, onUpdate }: QuestionCardProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [response, setResponse] = useState(question.notes || '');

  const handleStatusChange = async (newStatus: ClarifyingQuestionStatus) => {
    setIsUpdating(true);
    try {
      await onUpdate(question.questionId, { status: newStatus });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveResponse = async () => {
    setIsUpdating(true);
    try {
      await onUpdate(question.questionId, {
        notes: response,
        responseReceived: true,
        responseReceivedAt: new Date().toISOString(),
        status: 'ANSWERED',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            {PRIORITY_ICONS[question.priority]}
            <Badge className={CATEGORY_COLORS[question.category]}>
              {question.category}
            </Badge>
            <Badge className={STATUS_COLORS[question.status]}>
              {question.status}
            </Badge>
          </div>
          <p className="font-medium">{question.question}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onToggleExpand}>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </div>

      {isExpanded && (
        <div className="space-y-4 pt-3 border-t">
          {/* Rationale */}
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Why ask this question?
            </label>
            <p className="text-sm mt-1">{question.rationale}</p>
          </div>

          {/* Ambiguity source */}
          {question.ambiguitySource?.snippet && (
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Ambiguous RFP section:
              </label>
              <p className="text-sm mt-1 bg-muted/50 p-2 rounded italic">
                &quot;{question.ambiguitySource.snippet}&quot;
              </p>
              {question.ambiguitySource.sectionRef && (
                <p className="text-xs text-muted-foreground mt-1">
                  Reference: {question.ambiguitySource.sectionRef}
                </p>
              )}
            </div>
          )}

          {/* Status actions */}
          <div className="flex gap-2 flex-wrap">
            {question.status === 'SUGGESTED' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleStatusChange('REVIEWED')}
                  disabled={isUpdating}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Mark Reviewed
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleStatusChange('DISMISSED')}
                  disabled={isUpdating}
                >
                  Dismiss
                </Button>
              </>
            )}
            {question.status === 'REVIEWED' && (
              <Button
                size="sm"
                onClick={() => handleStatusChange('SUBMITTED')}
                disabled={isUpdating}
              >
                <Send className="h-4 w-4 mr-2" />
                Mark as Submitted
              </Button>
            )}
            {question.status === 'SUBMITTED' && !question.responseReceived && (
              <div className="w-full space-y-2">
                <label className="text-sm font-medium">CO Response:</label>
                <Textarea
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  placeholder="Paste or type the contracting officer's response..."
                  rows={3}
                />
                <Button
                  size="sm"
                  onClick={handleSaveResponse}
                  disabled={isUpdating || !response.trim()}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Save Response
                </Button>
              </div>
            )}
          </div>

          {/* CO Response if answered */}
          {question.responseReceived && question.notes && (
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                CO Response:
              </label>
              <p className="text-sm mt-1 bg-green-50 p-3 rounded border border-green-200">
                {question.notes}
              </p>
              {question.responseReceivedAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  Received: {new Date(question.responseReceivedAt).toLocaleDateString()}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
