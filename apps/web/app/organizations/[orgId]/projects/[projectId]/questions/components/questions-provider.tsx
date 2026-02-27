'use client';

import React, { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/use-toast';
import { AnswerSource, ConfidenceBreakdown, ConfidenceBand, GroupedSection, type QuestionFileItem, type SaveAnswerDTO } from '@auto-rfp/core';
import { useAnswers, useQuestions as useLoadQuestions } from '@/lib/hooks/use-api';
import { useProject } from '@/lib/hooks/use-project';
import { useGenerateAnswer, useSaveAnswer, useApproveAnswer } from '@/lib/hooks/use-answer';
import { useQuestionFiles } from '@/lib/hooks/use-question-file';
import { useKnowledgeBases } from '@/lib/hooks/use-knowledgebase';

import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import { normalizeConfidence } from '@/components/confidence/confidence-score-display';
import { useProjectContext } from '@/context/project-context';

// Interfaces
interface AnswerData {
  text: string;
  sources?: AnswerSource[];
  confidence?: number;
  confidenceBreakdown?: ConfidenceBreakdown;
  confidenceBand?: ConfidenceBand;
  // Status & audit fields
  status?: string;
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
}

interface ProjectIndex {
  id: string;
  name: string;
}

interface QuestionsContextType {
  // UI state
  showAIPanel: boolean;
  setShowAIPanel: (show: boolean) => void;
  selectedQuestion: string | null;
  setSelectedQuestion: (id: string | null) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  confidenceFilter: ConfidenceBand | 'all';
  setConfidenceFilter: (filter: ConfidenceBand | 'all') => void;
  sortByConfidence: boolean;
  setSortByConfidence: (sort: boolean) => void;

  // Data state
  isLoading: boolean;
  error: string | null;
  questions?: { sections: GroupedSection[] };
  questionFiles: QuestionFileItem[] | null;
  project: any;
  answers: Record<string, AnswerData>;
  unsavedQuestions: Set<string>;

  // Process state
  savingQuestions: Set<string>;
  lastSaved: string | null;
  isGenerating: Record<string, boolean>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedSource: AnswerSource | null;
  setSelectedSource: (source: AnswerSource | null) => void;
  isSourceModalOpen: boolean;
  setIsSourceModalOpen: (open: boolean) => void;
  selectedIndexes: Set<string>;
  setSelectedIndexes: (indexes: Set<string>) => void;
  availableIndexes: ProjectIndex[];
  isLoadingIndexes: boolean;
  organizationConnected: boolean;

  removingQuestions: Set<string>;

  // Action handlers
  handleAnswerChange: (questionId: string, value: string) => void;
  handleGenerateAnswer: (orgId: string, questionId: string) => Promise<void>;
  handleSaveAnswer: (questionId: string) => Promise<void>;
  saveAllAnswers: () => Promise<void>;
  handleExportAnswers: () => void;
  handleSourceClick: (source: AnswerSource) => void;
  handleIndexToggle: (indexId: string) => void;
  handleSelectAllIndexes: () => void;

  handleApproveAnswer: (questionId: string) => Promise<void>;
  approvingQuestions: Set<string>;
  handleUnapproveAnswer: (questionId: string) => Promise<void>;
  unapprovingQuestions: Set<string>;

  removeQuestion: (questionId: string) => Promise<void>;
  
  // Clustering - update answers locally when applied to similar questions
  handleBatchAnswerApplied: (targetQuestionIds: string[], answerText: string) => void;

  // Utility functions
  getFilteredQuestions: (filterType?: string) => any[];
  getCounts: () => { all: number; answered: number; unanswered: number };
  getConfidenceCounts: () => { high: number; medium: number; low: number };
  getSelectedQuestionData: () => any;
  refreshQuestions: () => Promise<void>;
}

const QuestionsContext = createContext<QuestionsContextType | undefined>(undefined);

export function useQuestions() {
  const context = useContext(QuestionsContext);
  if (context === undefined) {
    throw new Error('useQuestions must be used within a QuestionsProvider');
  }
  return context;
}

// Constant for "Other / Legacy Questions" option (questions without opportunityId)
const OTHER_LEGACY_OPPORTUNITY_ID = '__other__';

interface QuestionsProviderProps {
  children: ReactNode;
  projectId: string;
  opportunityId?: string | null;
}

export function QuestionsProvider({ children, projectId, opportunityId }: QuestionsProviderProps) {
  // UI state
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('all');

  // Data state
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerData>>({});
  const [unsavedQuestions, setUnsavedQuestions] = useState<Set<string>>(new Set());

  // Confidence filter/sort state
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceBand | 'all'>('all');
  const [sortByConfidence, setSortByConfidence] = useState(false);

  // Process state
  const [savingQuestions, setSavingQuestions] = useState<Set<string>>(new Set());
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState<AnswerSource | null>(null);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<string>>(new Set());
  const [availableIndexes, setAvailableIndexes] = useState<ProjectIndex[]>([]);
  const [isLoadingIndexes, setIsLoadingIndexes] = useState(false);
  const [organizationConnected, setOrganizationConnected] = useState(false);

  const [removingQuestions, setRemovingQuestions] = useState<Set<string>>(new Set());
  const [approvingQuestions, setApprovingQuestions] = useState<Set<string>>(new Set());
  const [unapprovingQuestions, setUnapprovingQuestions] = useState<Set<string>>(new Set());

  const { data: project, isLoading: isProjectLoading } = useProject(projectId);
  const { data: questions, isLoading: isQuestionsLoading, mutate: mutateQuestions } = useLoadQuestions(projectId);
  const { items: questionFiles, isLoading: isQuestionFilesLoading } = useQuestionFiles(projectId);
  const { data: answersData, error: answerError, isLoading: isAnswersLoading, mutate: mutateAnswers } = useAnswers(projectId);
  const { trigger: saveAnswer } = useSaveAnswer(projectId);
  const { trigger: approveAnswer } = useApproveAnswer(projectId);
  const { trigger: generateAnswer } = useGenerateAnswer();

  // Ref to track unsaved questions for autosave (avoids stale closure)
  const unsavedQuestionsRef = useRef<Set<string>>(new Set());
  const answersRef = useRef<Record<string, AnswerData>>({});

  // Get orgId from project to load knowledge bases
  const orgId = project?.orgId ?? null;
  const { data: knowledgeBases, isLoading: isKnowledgeBasesLoading } = useKnowledgeBases(orgId);

  const isLoading = isProjectLoading || isQuestionsLoading || isAnswersLoading;

  // Sync knowledge bases to available indexes state
  useEffect(() => {
    if (!projectId) {
      setError('No project ID provided');
      return;
    }

    setIsLoadingIndexes(isKnowledgeBasesLoading);

    if (knowledgeBases && knowledgeBases.length > 0) {
      const indexes: ProjectIndex[] = knowledgeBases.map((kb) => ({
        id: kb.id,
        name: kb.name,
      } as ProjectIndex));
      setAvailableIndexes(indexes);
      setOrganizationConnected(true);
      // Select all indexes by default
      setSelectedIndexes(new Set(indexes.map((idx) => idx.id)));
    } else if (!isKnowledgeBasesLoading) {
      setOrganizationConnected(false);
      setAvailableIndexes([]);
      setSelectedIndexes(new Set());
    }
  }, [projectId, knowledgeBases, isKnowledgeBasesLoading]);

  // Handle index selection
  const handleIndexToggle = (indexId: string) => {
    setSelectedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(indexId)) next.delete(indexId);
      else next.add(indexId);
      return next;
    });
  };

  const handleSelectAllIndexes = () => {
    if (selectedIndexes.size === availableIndexes.length) {
      setSelectedIndexes(new Set());
    } else {
      setSelectedIndexes(new Set(availableIndexes.map((index) => index.id)));
    }
  };

  // Handle answer changes
  const handleAnswerChange = (questionId: string, value: string) => {
    setAnswers((prev) => {
      const existing = prev[questionId] || { text: '' };
      return {
        ...prev,
        [questionId]: { ...existing, text: value },
      };
    });

    setUnsavedQuestions((prev) => {
      const next = new Set(prev);
      next.add(questionId);
      return next;
    });
  };

  // Generate answer
  const handleGenerateAnswer = async (orgId: string, questionId: string) => {
    const question = questions?.sections?.flatMap((s: any) => s.questions)?.find((q: any) => q.id === questionId);

    if (!question) {
      toast({ title: 'Error', description: 'Question not found', variant: 'destructive' });
      return;
    }

    setIsGenerating((prev) => ({ ...prev, [questionId]: true }));

    try {
      const { answer, confidence, confidenceBreakdown, confidenceBand, found, sources } = await generateAnswer({
        orgId,
        projectId,
        questionId,
        topK: 20,
      });

      setAnswers((prev) => ({
        ...prev,
        [questionId]: {
          text: answer,
          sources: sources,
          confidence,
          confidenceBreakdown,
          confidenceBand,
        } as AnswerData,
      }));

      if (answer) {
        setUnsavedQuestions((prev) => {
          const next = new Set(prev);
          next.add(questionId);
          return next;
        });
        toast({
          title: 'Answer Generated',
          description: 'AI-generated answer has been created. Please review and save it.',
        });
      } else {
        toast({
          title: 'Answer Not Found',
          description: 'Answer not found in provided documents',
          variant: 'destructive',
        });
      }

    } catch (error) {
      console.error('Error generating answer:', error);
      toast({
        title: 'Generation Error',
        description: 'Failed to generate answer. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating((prev) => ({ ...prev, [questionId]: false }));
    }
  };

  // Save a single answer
  const handleSaveAnswer = async (questionId: string) => {
    if (!projectId || !answers[questionId]) return;

    setSavingQuestions((prev) => {
      const next = new Set(prev);
      next.add(questionId);
      return next;
    });

    try {
      const answerData = answers[questionId];
      const response = await saveAnswer({
        questionId,
        text: answerData.text,
        sources: answerData.sources || [],
        ...(answerData.confidence !== undefined && { confidence: answerData.confidence }),
        ...(answerData.confidenceBreakdown && { confidenceBreakdown: answerData.confidenceBreakdown }),
        ...(answerData.confidenceBand && { confidenceBand: answerData.confidenceBand }),
      } as any);

      if (response?.id) {
        setUnsavedQuestions((prev) => {
          const next = new Set(prev);
          next.delete(questionId);
          return next;
        });

        setLastSaved(response.updatedAt);

        toast({ title: 'Answer Saved', description: 'Your answer has been saved successfully.' });
      } else {
        throw new Error('Failed to save answer');
      }
    } catch (error) {
      console.error(`Error saving answer for question ${questionId}:`, error);
      toast({
        title: 'Save Error',
        description: 'Failed to save your answer. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSavingQuestions((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }
  };

  // Save all unsaved answers
  const saveAllAnswers = async () => {
    if (!projectId || unsavedQuestions.size === 0) return;

    setSavingQuestions(new Set(unsavedQuestions));

    try {
      const toSave = Array.from(unsavedQuestions);

      await Promise.all(
        toSave.map(async (questionId) => {
          const text = answers[questionId]?.text;
          if (!text) return;
          await saveAnswer({ questionId, text } as SaveAnswerDTO);
        }),
      );

      setUnsavedQuestions(new Set());
      toast({
        title: 'All Answers Saved',
        description: `Successfully saved ${toSave.length} answers.`,
      });
    } catch (error) {
      console.error('Error saving all answers:', error);
      toast({
        title: 'Save Error',
        description: 'Failed to save your answers. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSavingQuestions(new Set());
    }
  };

  const handleExportAnswers = () => {
    if (!questions) return;

    const rows: any[] = [['Section', 'Question', 'Answer']];

    questions.sections.forEach((section: any) => {
      section.questions.forEach((question: any) => {
        rows.push([section.title, question.question, answers[question.id]?.text || '']);
      });
    });

    const csvContent = rows
      .map((row) =>
        row
          .map((cell: any) => (typeof cell === 'string' ? `"${cell.replace(/"/g, '""')}"` : cell))
          .join(','),
      )
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Question Answers.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getSelectedQuestionData = () => {
    if (!selectedQuestion || !questions) return null;

    for (const section of questions.sections) {
      const question = section.questions.find((q: any) => q.id === selectedQuestion);
      if (question) return { question, section };
    }
    return null;
  };

  // Helper to filter questions by opportunityId
  const filterByOpportunity = (questionsList: any[]) => {
    if (!opportunityId) return questionsList; // No filter applied
    
    const isOtherSelected = opportunityId === OTHER_LEGACY_OPPORTUNITY_ID;
    
    return questionsList.filter((q: any) => {
      const qOppId = q.opportunityId;
      if (isOtherSelected) {
        // For "Other / Legacy" - show questions without opportunityId
        return !qOppId || qOppId === null || qOppId === '';
      }
      // For normal opportunities - only show questions that match
      return qOppId === opportunityId;
    });
  };

  const getFilteredQuestions = (filterType = 'all') => {
    if (!questions) return [];

    let allQuestions = questions.sections.flatMap((section: any) =>
      section.questions.map((question: any) => ({
        ...question,
        sectionTitle: section.title,
        sectionId: section.id,
      })),
    );
    
    // Apply opportunity filter first
    allQuestions = filterByOpportunity(allQuestions);

    let statusFiltered = allQuestions;

    const hasAnswer = (q: any) => {
      const text = answers[q.id]?.text;
      return typeof text === 'string' && text.trim().length > 0;
    };

    if (filterType === 'answered') {
      statusFiltered = allQuestions.filter(hasAnswer);
    } else if (filterType === 'unanswered') {
      statusFiltered = allQuestions.filter((q: any) => !hasAnswer(q));
    }

    // Apply confidence band filter (only to questions that have answers)
    if (confidenceFilter !== 'all') {
      statusFiltered = statusFiltered.filter((q: any) => {
        const answerData = answers[q.id];
        // Skip unanswered questions — they have no confidence to filter on
        if (!answerData?.text || (typeof answerData.text === 'string' && answerData.text.trim().length === 0)) {
          return false;
        }
        if (answerData.confidence == null) return confidenceFilter === 'low'; // Has answer but no confidence = low
        const pct = Math.round(normalizeConfidence(answerData.confidence) * 100);
        if (confidenceFilter === 'high') return pct >= 90;
        if (confidenceFilter === 'medium') return pct >= 70 && pct < 90;
        return pct < 70; // low
      });
    }

    // Apply search query
    let result = statusFiltered;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((q: any) => q.question.toLowerCase().includes(query) || q.sectionTitle.toLowerCase().includes(query));
    }

    // Sort by confidence (lowest first) if enabled
    if (sortByConfidence) {
      result = [...result].sort((a: any, b: any) => {
        const confA = normalizeConfidence(answers[a.id]?.confidence ?? 0);
        const confB = normalizeConfidence(answers[b.id]?.confidence ?? 0);
        return confA - confB;
      });
    }

    return result;
  };

  const getCounts = () => {
    if (!questions) return { all: 0, answered: 0, unanswered: 0 };

    let allQuestions = questions.sections.flatMap((s: any) => s.questions);
    // Apply opportunity filter
    allQuestions = filterByOpportunity(allQuestions);
    
    const answeredCount = allQuestions.filter((q: any) => {
      const text = answers[q?.id]?.text;
      return typeof text === 'string' && text.trim().length > 0;
    }).length;

    return {
      all: allQuestions.length,
      answered: answeredCount,
      unanswered: allQuestions.length - answeredCount,
    };
  };

  const getConfidenceCounts = () => {
    if (!questions) return { high: 0, medium: 0, low: 0 };

    let allQuestions = questions.sections.flatMap((s: any) => s.questions);
    // Apply opportunity filter
    allQuestions = filterByOpportunity(allQuestions);
    
    let high = 0;
    let medium = 0;
    let low = 0;

    for (const q of allQuestions) {
      const answerData = answers[q.id];
      if (!answerData?.confidence) {
        if (answerData?.text) low++; // Has answer but no confidence = low
        continue;
      }
      const pct = Math.round(normalizeConfidence(answerData.confidence) * 100);
      if (pct >= 90) high++;
      else if (pct >= 70) medium++;
      else low++;
    }

    return { high, medium, low };
  };

  const handleSourceClick = (source: AnswerSource) => {
    setSelectedSource(source);
    setIsSourceModalOpen(true);
  };

  const refreshQuestions = async () => {
    setError(null);
    try {
      await mutateQuestions();
    } catch (error) {
      console.error('Error refreshing questions:', error);
      setError('Failed to refresh questions. Please try again.');
    }
  };

  // Handle batch answer applied from clustering
  const handleBatchAnswerApplied = (targetQuestionIds: string[], answerText: string) => {
    setAnswers((prev) => {
      const next = { ...prev };
      for (const qId of targetQuestionIds) {
        next[qId] = {
          ...(next[qId] || {}),
          text: answerText,
        };
      }
      return next;
    });
    
    // These are now saved on server, so remove from unsaved set
    setUnsavedQuestions((prev) => {
      const next = new Set(prev);
      for (const qId of targetQuestionIds) {
        next.delete(qId);
      }
      return next;
    });
  };

  const removeQuestion = async (questionId: string) => {
    if (!projectId || !questionId) return;

    setRemovingQuestions((prev) => {
      const next = new Set(prev);
      next.add(questionId);
      return next;
    });

    try {
      // Pass orgId so the backend can cascade-delete assignments and comments
      const orgIdParam = orgId ? `&orgId=${orgId}` : '';
      const res = await authFetcher(
        `${env.BASE_API_URL}/question/delete-question?projectId=${projectId}&questionId=${questionId}${orgIdParam}`,
        {
          method: 'DELETE',
          cache: 'no-store',
        });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Request failed: ${res.status}`);
      }

      // update local document immediately
      const nextDoc: any = questions
        ? {
          ...questions,
          sections: questions.sections.map((s: any) => ({
            ...s,
            questions: s.questions.filter((q: any) => q.id !== questionId),
          })),
        }
        : null;

      // mutateQuestions supports optimistic update if you pass data.
      // If your `useLoadQuestions` hook returns `mutate` from SWR, this will work.
      await mutateQuestions(nextDoc, { revalidate: false } as any);

      // remove local answer + unsaved marker
      setAnswers((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });

      setUnsavedQuestions((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });

      // clear selection if needed
      if (selectedQuestion === questionId) {
        setSelectedQuestion(null);
        setShowAIPanel(false);
      }

      toast({ title: 'Question removed', description: 'Question (and answer if existed) was deleted.' });
    } catch (error) {
      console.error('Error removing question:', error);
      toast({
        title: 'Remove Error',
        description: error instanceof Error ? error.message : 'Failed to remove question',
        variant: 'destructive',
      });
    } finally {
      setRemovingQuestions((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }
  };

  // Poll answers from server every 10s to pick up changes from other users
  // (approve, unapprove, save, last edited by, approved by)
  useEffect(() => {
    const pollInterval = setInterval(() => {
      if (unsavedQuestionsRef.current.size === 0 && mutateAnswers) {
        mutateAnswers();
      }
    }, 10_000);
    return () => clearInterval(pollInterval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Sync selected question text to the global header breadcrumb
  const { setBreadcrumbSuffix } = useProjectContext();
  useEffect(() => {
    if (selectedQuestion && questions) {
      const qData = getSelectedQuestionData();
      const text = qData?.question?.question as string | undefined;
      setBreadcrumbSuffix(text ? (text.length > 50 ? `${text.slice(0, 50)}…` : text) : null);
    } else {
      setBreadcrumbSuffix(null);
    }
    return () => setBreadcrumbSuffix(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuestion, questions]);

  // Sync server answer data to local state.
  // Merge server metadata (status, updatedByName, approvedByName, etc.) 
  // while preserving local text edits for unsaved questions.
  useEffect(() => {
    if (!answersData) return;
    setAnswers((prev) => {
      const next: Record<string, AnswerData> = {};
      for (const [qId, serverAnswer] of Object.entries(answersData)) {
        const local = prev[qId];
        const hasLocalEdit = unsavedQuestionsRef.current.has(qId);
        next[qId] = {
          ...serverAnswer,
          // Preserve local text if user has unsaved edits
          ...(hasLocalEdit && local ? { text: local.text } : {}),
        };
      }
      // Also preserve any local-only entries not yet on server
      for (const [qId, localAnswer] of Object.entries(prev)) {
        if (!next[qId]) next[qId] = localAnswer;
      }
      return next;
    });
  }, [answersData]);

  // Keep refs in sync so autosave interval can read latest values without stale closure
  useEffect(() => {
    unsavedQuestionsRef.current = unsavedQuestions;
  }, [unsavedQuestions]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Autosave as DRAFT every 5 seconds for any unsaved questions
  useEffect(() => {
    const interval = setInterval(async () => {
      const toSave = Array.from(unsavedQuestionsRef.current);
      if (toSave.length === 0) return;

      for (const questionId of toSave) {
        const answerData = answersRef.current[questionId];
        if (!answerData?.text?.trim()) continue;

        try {
          await saveAnswer({
            questionId,
            text: answerData.text,
            sources: answerData.sources || [],
            status: 'DRAFT',
            ...(answerData.confidence !== undefined && { confidence: answerData.confidence }),
            ...(answerData.confidenceBreakdown && { confidenceBreakdown: answerData.confidenceBreakdown }),
            ...(answerData.confidenceBand && { confidenceBand: answerData.confidenceBand }),
          } as any);

          setUnsavedQuestions((prev) => {
            const next = new Set(prev);
            next.delete(questionId);
            return next;
          });
          setLastSaved(new Date().toISOString());
        } catch {
          // Silently ignore autosave errors — user can still manually approve
        }
      }
    }, 5_000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Approve answer — saves with status=APPROVED and logs ANSWER_APPROVED activity
  const handleApproveAnswer = async (questionId: string) => {
    if (!projectId || !answers[questionId]) return;

    setApprovingQuestions((prev) => {
      const next = new Set(prev);
      next.add(questionId);
      return next;
    });

    try {
      const answerData = answers[questionId];
      const response = await approveAnswer({
        questionId,
        text: answerData.text,
        sources: answerData.sources || [],
        status: 'APPROVED',
        ...(answerData.confidence !== undefined && { confidence: answerData.confidence }),
        ...(answerData.confidenceBreakdown && { confidenceBreakdown: answerData.confidenceBreakdown }),
        ...(answerData.confidenceBand && { confidenceBand: answerData.confidenceBand }),
      } as any);

      if (response?.id) {
        // Update local answers state immediately so the UI reflects the new status
        setAnswers((prev) => ({
          ...prev,
          [questionId]: {
            ...prev[questionId],
            text: response.text ?? prev[questionId]?.text ?? '',
            status: 'APPROVED',
            approvedBy: response.approvedBy,
            approvedByName: response.approvedByName,
            approvedAt: response.approvedAt,
            updatedBy: response.updatedBy,
            updatedByName: response.updatedByName,
            updatedAt: response.updatedAt,
          },
        }));
        setUnsavedQuestions((prev) => {
          const next = new Set(prev);
          next.delete(questionId);
          return next;
        });
        setLastSaved(response.updatedAt);
        toast({ title: 'Answer Approved', description: 'Answer has been approved successfully.' });
      } else {
        throw new Error('Failed to approve answer');
      }
    } catch (error) {
      console.error(`Error approving answer for question ${questionId}:`, error);
      toast({
        title: 'Approve Error',
        description: 'Failed to approve the answer. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setApprovingQuestions((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }
  };

  // Unapprove answer — reverts status back to DRAFT
  const handleUnapproveAnswer = async (questionId: string) => {
    if (!projectId || !answers[questionId]) return;

    setUnapprovingQuestions((prev) => {
      const next = new Set(prev);
      next.add(questionId);
      return next;
    });

    try {
      const answerData = answers[questionId];
      const response = await saveAnswer({
        questionId,
        text: answerData.text,
        sources: answerData.sources || [],
        status: 'DRAFT',
        ...(answerData.confidence !== undefined && { confidence: answerData.confidence }),
        ...(answerData.confidenceBreakdown && { confidenceBreakdown: answerData.confidenceBreakdown }),
        ...(answerData.confidenceBand && { confidenceBand: answerData.confidenceBand }),
      } as any);

      if (response?.id) {
        // Update local answers state immediately so the UI reflects the reverted status
        setAnswers((prev) => ({
          ...prev,
          [questionId]: {
            ...prev[questionId],
            text: response.text ?? prev[questionId]?.text ?? '',
            status: 'DRAFT',
            approvedBy: undefined,
            approvedByName: undefined,
            approvedAt: undefined,
            updatedBy: response.updatedBy,
            updatedByName: response.updatedByName,
            updatedAt: response.updatedAt,
          },
        }));
        setLastSaved(response.updatedAt);
        toast({ title: 'Approval Reverted', description: 'Answer moved back to draft.' });
      } else {
        throw new Error('Failed to unapprove answer');
      }
    } catch (error) {
      console.error(`Error unapproving answer for question ${questionId}:`, error);
      toast({
        title: 'Error',
        description: 'Failed to revert approval. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setUnapprovingQuestions((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }
  };

  const value: QuestionsContextType = {
    // UI state
    showAIPanel,
    setShowAIPanel,
    selectedQuestion,
    setSelectedQuestion,
    activeTab,
    setActiveTab,
    confidenceFilter,
    setConfidenceFilter,
    sortByConfidence,
    setSortByConfidence,

    // Data state
    isLoading,
    error,
    questions,
    questionFiles: questionFiles ?? null,
    project,
    answers,
    unsavedQuestions,

    // Process state
    savingQuestions,
    lastSaved,
    isGenerating,
    searchQuery,
    setSearchQuery,
    selectedSource,
    setSelectedSource,
    isSourceModalOpen,
    setIsSourceModalOpen,
    selectedIndexes,
    setSelectedIndexes,
    availableIndexes,
    isLoadingIndexes,
    organizationConnected,

    removingQuestions,

    // Action handlers
    handleAnswerChange,
    handleGenerateAnswer,
    handleSaveAnswer,
    saveAllAnswers,
    handleExportAnswers,
    handleSourceClick,
    handleIndexToggle,
    handleSelectAllIndexes,
    handleApproveAnswer,
    approvingQuestions,
    handleUnapproveAnswer,
    unapprovingQuestions,
    removeQuestion,
    handleBatchAnswerApplied,
    getFilteredQuestions,
    getCounts,
    getConfidenceCounts,
    getSelectedQuestionData,
    refreshQuestions,
  };

  return <QuestionsContext.Provider value={value}>{children}</QuestionsContext.Provider>;
}