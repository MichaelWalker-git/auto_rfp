'use client';

import React, { createContext, useContext, useCallback, useMemo } from 'react';
import useSWR, { mutate } from 'swr';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { ClarifyingQuestionItem, EngagementLogItem, EngagementMetrics, Deadline } from '@auto-rfp/core';

const BASE_URL = env.BASE_API_URL;

interface QuestionDeadlineInfo {
  dateIso: string;
  label: string;
  daysLeft: number;
  isPast: boolean;
  warningLevel: 'urgent' | 'warning' | 'ok' | 'expired';
}

interface QAEngagementContextValue {
  orgId: string;
  projectId: string;
  opportunityId: string;
  // Questions
  questions: ClarifyingQuestionItem[];
  questionsLoading: boolean;
  questionsError: Error | null;
  generateQuestions: (force?: boolean) => Promise<void>;
  updateQuestion: (questionId: string, data: Partial<ClarifyingQuestionItem>) => Promise<void>;
  refreshQuestions: () => void;
  // Engagement logs
  engagementLogs: EngagementLogItem[];
  logsLoading: boolean;
  logsError: Error | null;
  createEngagementLog: (data: Partial<EngagementLogItem>) => Promise<void>;
  refreshLogs: () => void;
  // Metrics
  metrics: EngagementMetrics | null;
  metricsLoading: boolean;
  metricsError: Error | null;
  refreshMetrics: () => void;
  // Question deadline
  questionDeadline: QuestionDeadlineInfo | null;
  deadlinesLoading: boolean;
}

const QAEngagementContext = createContext<QAEngagementContextValue | null>(null);

interface QAEngagementProviderProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  children: React.ReactNode;
}

// Helper to parse JSON response
async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || 'Request failed');
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// SWR fetcher using authFetcher
async function swrFetcher<T>(url: string): Promise<T> {
  const res = await authFetcher(url, { method: 'GET' });
  return parseResponse<T>(res);
}

export function QAEngagementProvider({
  orgId,
  projectId,
  opportunityId,
  children,
}: QAEngagementProviderProps) {
  // Questions SWR - include orgId in all API calls
  const questionsUrl = `${BASE_URL}/clarifying-question/list?orgId=${orgId}&projectId=${projectId}&opportunityId=${opportunityId}`;
  const {
    data: questionsData,
    error: questionsError,
    isLoading: questionsLoading,
  } = useSWR<{ ok: boolean; items: ClarifyingQuestionItem[] }>(questionsUrl, swrFetcher);

  // Engagement logs SWR
  const logsUrl = `${BASE_URL}/engagement-log/list?orgId=${orgId}&projectId=${projectId}&opportunityId=${opportunityId}`;
  const {
    data: logsData,
    error: logsError,
    isLoading: logsLoading,
  } = useSWR<{ ok: boolean; items: EngagementLogItem[] }>(logsUrl, swrFetcher);

  // Metrics SWR
  const metricsUrl = `${BASE_URL}/engagement-log/metrics?orgId=${orgId}&projectId=${projectId}&opportunityId=${opportunityId}`;
  const {
    data: metricsData,
    error: metricsError,
    isLoading: metricsLoading,
  } = useSWR<{ ok: boolean; metrics: EngagementMetrics }>(metricsUrl, swrFetcher);

  // Deadlines SWR (for question submission deadline)
  const deadlinesUrl = `${BASE_URL}/deadlines/get-deadlines?orgId=${orgId}&projectId=${projectId}&opportunityId=${opportunityId}`;
  interface EnrichedDeadline extends Deadline {
    daysUntil?: number;
    warningLevel?: 'urgent' | 'warning' | 'ok' | 'expired';
  }
  interface DeadlinesResponse {
    ok: boolean;
    deadlines: Array<{
      deadlines?: EnrichedDeadline[];
      opportunityId?: string;
    }>;
  }
  const {
    data: deadlinesData,
    isLoading: deadlinesLoading,
  } = useSWR<DeadlinesResponse>(deadlinesUrl, swrFetcher, {
    onError: () => {}, // Don't throw - deadline is optional
  });

  // Extract question deadline from deadlines response
  const questionDeadline = useMemo<QuestionDeadlineInfo | null>(() => {
    if (!deadlinesData?.deadlines?.length) return null;
    
    // Find question/inquiry deadline types
    const questionDeadlineLabels = ['QUESTIONS', 'Q&A', 'INQUIRY', 'RFI', 'QUESTION'];
    
    for (const projectDeadlines of deadlinesData.deadlines) {
      if (!projectDeadlines.deadlines) continue;
      
      for (const d of projectDeadlines.deadlines) {
        const typeUpper = ((d.type || '') + ' ' + (d.label || '')).toUpperCase();
        if (questionDeadlineLabels.some(t => typeUpper.includes(t))) {
          if (!d.dateTimeIso) continue;
          
          const daysLeft = d.daysUntil ?? 0;
          return {
            dateIso: d.dateTimeIso,
            label: d.label || d.type || 'Question Submission',
            daysLeft,
            isPast: daysLeft < 0,
            warningLevel: d.warningLevel ?? (daysLeft < 0 ? 'expired' : daysLeft <= 3 ? 'urgent' : daysLeft <= 7 ? 'warning' : 'ok'),
          };
        }
      }
    }
    
    return null;
  }, [deadlinesData]);

  // Generate questions
  const generateQuestions = useCallback(
    async (force = false) => {
      const res = await authFetcher(`${BASE_URL}/clarifying-question/generate?orgId=${orgId}`, {
        method: 'POST',
        body: JSON.stringify({ projectId, opportunityId, force }),
      });
      await parseResponse(res);
      mutate(questionsUrl);
    },
    [orgId, projectId, opportunityId, questionsUrl],
  );

  // Update question
  const updateQuestion = useCallback(
    async (questionId: string, data: Partial<ClarifyingQuestionItem>) => {
      const res = await authFetcher(
        `${BASE_URL}/clarifying-question/${questionId}?orgId=${orgId}&projectId=${projectId}&opportunityId=${opportunityId}`,
        {
          method: 'PUT',
          body: JSON.stringify(data),
        },
      );
      await parseResponse(res);
      mutate(questionsUrl);
      mutate(metricsUrl);
    },
    [orgId, projectId, opportunityId, questionsUrl, metricsUrl],
  );

  // Create engagement log
  const createEngagementLog = useCallback(
    async (data: Partial<EngagementLogItem>) => {
      const res = await authFetcher(`${BASE_URL}/engagement-log/create?orgId=${orgId}`, {
        method: 'POST',
        body: JSON.stringify({ ...data, orgId, projectId, opportunityId }),
      });
      await parseResponse(res);
      mutate(logsUrl);
      mutate(metricsUrl);
    },
    [orgId, projectId, opportunityId, logsUrl, metricsUrl],
  );

  // Refresh functions
  const refreshQuestions = useCallback(() => mutate(questionsUrl), [questionsUrl]);
  const refreshLogs = useCallback(() => mutate(logsUrl), [logsUrl]);
  const refreshMetrics = useCallback(() => mutate(metricsUrl), [metricsUrl]);

  const value = useMemo<QAEngagementContextValue>(
    () => ({
      orgId,
      projectId,
      opportunityId,
      questions: questionsData?.items ?? [],
      questionsLoading,
      questionsError: questionsError ?? null,
      generateQuestions,
      updateQuestion,
      refreshQuestions,
      engagementLogs: logsData?.items ?? [],
      logsLoading,
      logsError: logsError ?? null,
      createEngagementLog,
      refreshLogs,
      metrics: metricsData?.metrics ?? null,
      metricsLoading,
      metricsError: metricsError ?? null,
      refreshMetrics,
      questionDeadline,
      deadlinesLoading,
    }),
    [
      orgId,
      projectId,
      opportunityId,
      questionsData,
      questionsLoading,
      questionsError,
      generateQuestions,
      updateQuestion,
      refreshQuestions,
      logsData,
      logsLoading,
      logsError,
      createEngagementLog,
      refreshLogs,
      metricsData,
      metricsLoading,
      metricsError,
      refreshMetrics,
      questionDeadline,
      deadlinesLoading,
    ],
  );

  return (
    <QAEngagementContext.Provider value={value}>
      {children}
    </QAEngagementContext.Provider>
  );
}

export function useQAEngagementContext() {
  const context = useContext(QAEngagementContext);
  if (!context) {
    throw new Error('useQAEngagementContext must be used within a QAEngagementProvider');
  }
  return context;
}
