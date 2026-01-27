'use client';

import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { toast } from '@/components/ui/use-toast';
import { AnswerSource, GroupedSection, type QuestionFileItem, type SaveAnswerDTO } from '@auto-rfp/shared';
import { useAnswers, useQuestions as useLoadQuestions } from '@/lib/hooks/use-api';
import { useProject } from '@/lib/hooks/use-project';
import { useGenerateAnswer, useSaveAnswer } from '@/lib/hooks/use-answer';
import { useQuestionFiles } from '@/lib/hooks/use-question-file';

import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';

// Interfaces
interface AnswerData {
  text: string;
  sources?: AnswerSource[];
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

  removeQuestion: (questionId: string) => Promise<void>;

  // Utility functions
  getFilteredQuestions: (filterType?: string) => any[];
  getCounts: () => { all: number; answered: number; unanswered: number };
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

interface QuestionsProviderProps {
  children: ReactNode;
  projectId: string;
}

export function QuestionsProvider({ children, projectId }: QuestionsProviderProps) {
  // UI state
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('all');

  // Data state
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerData>>({});
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [unsavedQuestions, setUnsavedQuestions] = useState<Set<string>>(new Set());

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

  const { data: project, isLoading: isProjectLoading } = useProject(projectId);
  const { data: questions, isLoading: isQuestionsLoading, mutate: mutateQuestions } = useLoadQuestions(projectId);
  const { items: questionFiles, isLoading: isQuestionFilesLoading } = useQuestionFiles(projectId);
  const { data: answersData, error: answerError, isLoading: isAnswersLoading } = useAnswers(projectId);
  const { trigger: saveAnswer } = useSaveAnswer(projectId);
  const { trigger: generateAnswer } = useGenerateAnswer();

  const isLoading = isProjectLoading || isQuestionsLoading || isAnswersLoading;

  // Load indexes when component mounts
  useEffect(() => {
    if (!projectId) {
      setError('No project ID provided');
      return;
    }

    const fetchIndexes = async () => {
      setIsLoadingIndexes(true);
      try {
        // TODO: restore indexes loading when endpoint is ready
      } catch (error) {
        console.error('Error loading indexes:', error);
        setOrganizationConnected(false);
        setAvailableIndexes([]);
        setSelectedIndexes(new Set());
      } finally {
        setIsLoadingIndexes(false);
      }
    };

    Promise.all([fetchIndexes()]).catch((error) => {
      console.error('Error in parallel loading:', error);
    });
  }, [projectId]);

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
      const { answer, confidence, found, sources } = await generateAnswer({
        orgId,
        projectId,
        questionId,
        topK: 20,
      });

      setAnswers((prev) => ({
        ...prev,
        [questionId]: { text: answer, sources: sources } as AnswerData,
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

      setConfidence((prev) => ({ ...prev, [questionId]: confidence }));
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
      const response = await saveAnswer({
        questionId,
        text: answers[questionId].text,
        sources: answers[questionId].sources || [],
      } as SaveAnswerDTO);

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

  const getFilteredQuestions = (filterType = 'all') => {
    if (!questions) return [];

    const allQuestions = questions.sections.flatMap((section: any) =>
      section.questions.map((question: any) => ({
        ...question,
        sectionTitle: section.title,
        sectionId: section.id,
      })),
    );

    let statusFiltered = allQuestions;

    if (filterType === 'answered') {
      statusFiltered = allQuestions.filter((q: any) => !!answers[q.id]?.text?.trim());
    } else if (filterType === 'unanswered') {
      statusFiltered = allQuestions.filter((q: any) => !answers[q.id]?.text?.trim());
    }

    if (!searchQuery) return statusFiltered;

    const query = searchQuery.toLowerCase();
    return statusFiltered.filter((q: any) => q.question.toLowerCase().includes(query) || q.sectionTitle.toLowerCase().includes(query));
  };

  const getCounts = () => {
    if (!questions) return { all: 0, answered: 0, unanswered: 0 };

    const allQuestions = questions.sections.flatMap((s: any) => s.questions);
    const answeredCount = allQuestions.filter((q: any) => !!answers[q?.id]?.text?.trim()).length;

    return {
      all: allQuestions.length,
      answered: answeredCount,
      unanswered: allQuestions.length - answeredCount,
    };
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

  const removeQuestion = async (questionId: string) => {
    if (!projectId || !questionId) return;

    setRemovingQuestions((prev) => {
      const next = new Set(prev);
      next.add(questionId);
      return next;
    });

    try {
      const res = await authFetcher(
        `${env.BASE_API_URL}/question/delete-question?projectId=${projectId}&questionId=${questionId}`,
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

  useEffect(() => {
    if (answersData) setAnswers({ ...answersData });
  }, [answersData]);

  const value: QuestionsContextType = {
    // UI state
    showAIPanel,
    setShowAIPanel,
    selectedQuestion,
    setSelectedQuestion,
    activeTab,
    setActiveTab,

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
    removeQuestion,
    getFilteredQuestions,
    getCounts,
    getSelectedQuestionData,
    refreshQuestions,
  };

  return <QuestionsContext.Provider value={value}>{children}</QuestionsContext.Provider>;
}