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

// Track if we've already warned about missing WebSocket URL
let wsWarningShown = false;

export function useWebSocket({ projectId, orgId, onMessage, enabled = true }: UseWebSocketOptions) {
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    if (!enabled || !projectId || !orgId) return;

    // Skip WebSocket connection if URL is not configured
    const wsUrl = process.env.NEXT_PUBLIC_WS_API_URL ?? '';
    if (!wsUrl || (!wsUrl.startsWith('wss://') && !wsUrl.startsWith('ws://'))) {
      if (!wsWarningShown) {
        wsWarningShown = true;
        console.warn('WebSocket URL not configured or invalid, collaboration features disabled');
      }
      return;
    }

    let mounted = true;

    const init = async () => {
      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();
        if (!token || !mounted) return;

        const client = new WsClient({ wsUrl, token, projectId, orgId, onMessage });
        clientRef.current = client;
        client.connect();
      } catch (err) {
        console.warn('Failed to initialize WebSocket connection:', err);
      }
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
