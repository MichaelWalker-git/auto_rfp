'use client';

import { useEffect, useRef, useCallback } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { WsClient } from '../lib/ws-client';
import type { WsOutboundMessage } from '@auto-rfp/core';

interface UseWebSocketOptions {
  projectId: string;
  orgId: string;
  onMessage: (msg: WsOutboundMessage) => void;
  enabled?: boolean;
}

export function useWebSocket({ projectId, orgId, onMessage, enabled = true }: UseWebSocketOptions) {
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    if (!enabled || !projectId || !orgId) return;

    let mounted = true;

    const init = async () => {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      if (!token || !mounted) return;

      const wsUrl = process.env.NEXT_PUBLIC_WS_API_URL ?? '';
      const client = new WsClient({ wsUrl, token, projectId, orgId, onMessage });
      clientRef.current = client;
      client.connect();
    };

    init();

    return () => {
      mounted = false;
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, orgId, enabled]);

  const updatePresence = useCallback((questionId: string | undefined, status: string) => {
    clientRef.current?.updatePresence(questionId, status);
  }, []);

  const lockEditing = useCallback((questionId: string) => {
    clientRef.current?.lockEditing(questionId);
  }, []);

  const unlockEditing = useCallback((questionId: string) => {
    clientRef.current?.unlockEditing(questionId);
  }, []);

  const sendAnswerDelta = useCallback((questionId: string, text: string) => {
    clientRef.current?.sendAnswerDelta(questionId, text);
  }, []);

  const sendAnswerStatus = useCallback((questionId: string, meta: {
    status?: string;
    updatedByName?: string;
    updatedAt?: string;
    approvedByName?: string;
    approvedAt?: string;
  }) => {
    clientRef.current?.sendAnswerStatus(questionId, meta);
  }, []);

  return { updatePresence, lockEditing, unlockEditing, sendAnswerDelta, sendAnswerStatus };
}
