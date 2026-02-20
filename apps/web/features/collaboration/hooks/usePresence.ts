'use client';

import { useState, useCallback, useRef } from 'react';
import type { PresenceItem, WsOutboundMessage } from '@auto-rfp/core';
import { useWebSocket } from './useWebSocket';

interface AnswerDeltaPayload {
  userId: string;
  displayName?: string;
  questionId: string;
  text: string;
}

interface AnswerStatusPayload {
  questionId: string;
  status?: string;
  updatedByName?: string;
  updatedAt?: string;
  approvedByName?: string;
  approvedAt?: string;
}

interface EditingLockPayload {
  questionId: string;
  userId?: string;
  displayName?: string;
}

interface LiveAnswerEntry {
  text: string;
  userId: string;
  displayName?: string;
}

export function usePresence(projectId: string, orgId: string) {
  const [presenceMap, setPresenceMap] = useState<Map<string, PresenceItem>>(new Map());
  // Live answer data received from other users: questionId → { text, userId, displayName }
  const [liveAnswerMap, setLiveAnswerMap] = useState<Map<string, LiveAnswerEntry>>(new Map());
  // Live answer metadata (status, last edited by, approved by) from other users
  const [answerStatusMap, setAnswerStatusMap] = useState<Map<string, AnswerStatusPayload>>(new Map());
  // Tracks which questions are locked by other users: questionId → { userId, displayName }
  const [lockedQuestionsMap, setLockedQuestionsMap] = useState<Map<string, { userId: string; displayName: string }>>(new Map());
  // Debounce timer for sending answer deltas
  const deltaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMessage = useCallback((msg: WsOutboundMessage) => {
    if (msg.type === 'PRESENCE_UPDATE') {
      const item = msg.payload as PresenceItem;
      setPresenceMap((prev) => {
        const next = new Map(prev);
        next.set(item.userId, item);
        return next;
      });
    }

    if (msg.type === 'ANSWER_DELTA') {
      const { questionId, text, userId, displayName } = msg.payload as AnswerDeltaPayload;
      setLiveAnswerMap((prev) => {
        const next = new Map(prev);
        next.set(questionId, { text, userId, displayName });
        return next;
      });
    }

    if (msg.type === 'ANSWER_STATUS') {
      const payload = msg.payload as AnswerStatusPayload;
      setAnswerStatusMap((prev) => {
        const next = new Map(prev);
        next.set(payload.questionId, payload);
        return next;
      });
    }

    // Handle editing locks from other users
    if (msg.type === 'EDITING_LOCK') {
      const { questionId, userId, displayName } = msg.payload as EditingLockPayload;
      if (questionId && userId) {
        setLockedQuestionsMap((prev) => {
          const next = new Map(prev);
          next.set(questionId, { userId, displayName: displayName ?? 'Someone' });
          return next;
        });
      }
    }

    if (msg.type === 'EDITING_UNLOCK') {
      const { questionId } = msg.payload as EditingLockPayload;
      if (questionId) {
        setLockedQuestionsMap((prev) => {
          const next = new Map(prev);
          next.delete(questionId);
          return next;
        });
      }
    }
  }, []);

  const { updatePresence, lockEditing, unlockEditing, sendAnswerDelta: wsSendDelta, sendAnswerStatus: wsSendStatus } = useWebSocket({
    projectId,
    orgId,
    onMessage: handleMessage,
  });

  const activeUsers = Array.from(presenceMap.values());

  const getUsersOnQuestion = useCallback(
    (questionId: string) => activeUsers.filter((u) => u.questionId === questionId),
    [activeUsers],
  );

  /**
   * Send a debounced answer delta to collaborators.
   * Debounced at 300ms to avoid flooding the WebSocket.
   */
  const sendAnswerDelta = useCallback(
    (questionId: string, text: string) => {
      if (deltaTimerRef.current) clearTimeout(deltaTimerRef.current);
      deltaTimerRef.current = setTimeout(() => {
        wsSendDelta(questionId, text);
      }, 300);
    },
    [wsSendDelta],
  );

  // Backward-compatible: liveAnswers as Map<questionId, text>
  const liveAnswers = new Map(
    Array.from(liveAnswerMap.entries()).map(([qId, entry]) => [qId, entry.text]),
  );

  /** Send answer metadata (status, edited by, approved by) to collaborators */
  const sendAnswerStatus = useCallback(
    (questionId: string, meta: {
      status?: string;
      updatedByName?: string;
      updatedAt?: string;
      approvedByName?: string;
      approvedAt?: string;
    }) => {
      wsSendStatus(questionId, meta);
    },
    [wsSendStatus],
  );

  /** Get the lock info for a specific question (from EDITING_LOCK messages) */
  const getQuestionLock = useCallback(
    (questionId: string) => lockedQuestionsMap.get(questionId) ?? null,
    [lockedQuestionsMap],
  );

  return {
    activeUsers,
    getUsersOnQuestion,
    getQuestionLock,
    lockedQuestionsMap,
    updatePresence,
    lockEditing,
    unlockEditing,
    sendAnswerDelta,
    sendAnswerStatus,
    liveAnswers,
    liveAnswerMap,
    answerStatusMap,
  };
}
